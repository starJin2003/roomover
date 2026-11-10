import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { publish } from "@/lib/agents/bus";
import { RUN_LIMITS } from "@/lib/agents/limits";
import { roomLabel } from "@/lib/agents/buyer/run";
import type { VerifierTransport } from "@/lib/agents/verifier/compare";
import { writeDisputeNote, type DisputeNoteResult, type DisputeNoteUsage } from "@/lib/agents/verifier/dispute";
import { writeInquiryMessage, type InquiryMessageResult } from "@/lib/agents/verifier/inquiry";
import type { PayPalReads, PayPalReadToolName } from "@/lib/agents/tools/paypal-read";
import { disputeRecordingKey, inquiryRecordingKey } from "@/lib/agents/recording";
import type { Database } from "@/lib/db/client";
import { claimEvidence, claimMessage, disputedRecords, finishEvidence, finishMessage, loadDispute, recordDisputeUpdate, type DisputeRow } from "@/lib/db/disputes";
import { loadHandoffOrderById } from "@/lib/db/handoffs";
import { claudeCallsToday, insertEvents, loadSessionPlan, orderEventViews, type Transaction } from "@/lib/db/plans";
import { listings } from "@/lib/db/schema";
import { composeInquiryMessage, decideEvidence, decideInquiryMessage, disputeWords, evidenceBundleSchema, type DisputeUpdateStep, type EvidenceBundle } from "@/lib/domain/dispute";
import type { ClaudeMode } from "@/lib/domain/enums";
import { layoutRefs, presetFor } from "@/lib/handoff/load";
import { shortNoun } from "@/lib/handoff/words";
import { PayPalApiError } from "@/lib/paypal/errors";
import type { PayPalRestClient } from "@/lib/paypal/rest/client";
import { paypalDisputeSchema, provideDisputeEvidence, sendDisputeMessage } from "@/lib/paypal/rest/disputes";
import { codeInquiryMessage, codeNote, composeNotes, evidenceFiles, KIND_WORDS, noteFacts, recordPdf, timelineOf, type DisputeContext } from "./evidence";
import { disputeReport, type DisputeReport } from "./report";

/**
 * What happens on Roomover's side of a PayPal dispute. The verifier agent
 * reads the dispute, the order, and the disputed transaction through the
 * PayPal Agent Toolkit's read only tools. Code decides whether evidence is
 * due, takes the one submission for the stage, builds the evidence from
 * stored records, and sends it through the Disputes API. Every step writes
 * one activity line on the order.
 */

export interface DisputeDeps {
  db: Database;
  rest: PayPalRestClient;
  reads: PayPalReads;
  transportFor(key: string): Promise<{ mode: ClaudeMode; transport: VerifierTransport }>;
  now(): Date;
}

type Db = Database | Transaction;

const TOOLKIT_API = "Agent Toolkit";
const READ_KIND = { get_dispute: "dispute", get_order: "order", list_transactions: "transaction" } as const;

/** One toolkit read with its activity line. A failed read writes a blocked line and throws on. */
export async function toolkitRead(db: Db, reads: PayPalReads, line: { runId: string; planId: string | null; orderId: string | null }, name: PayPalReadToolName, input: Record<string, unknown>, id: string): Promise<string> {
  const started = Date.now();
  const record = async (ok: boolean, summary: string) => {
    const events = await insertEvents(db, {
      runId: line.runId,
      planId: line.planId,
      ...(line.orderId === null ? {} : { orderId: line.orderId }),
      agent: "verifier",
      drafts: [{ tool: name, summary, blocked: !ok, paypal: { api: TOOLKIT_API, id }, detail: { toolkit: { tool: name, source: reads.source, ok }, paypalIdKind: READ_KIND[name], latencyMs: Date.now() - started } }],
    });
    if (line.planId !== null) for (const event of events) publish(line.planId, { type: "event", event });
  };
  try {
    const json = await reads.read(name, input);
    await record(true, `Read ${READ_KIND[name]} ${id} through the PayPal Agent Toolkit's ${name}${reads.source === "recorded" ? ", from the recorded sandbox" : ""}.`);
    return json;
  } catch (error) {
    await record(false, `The PayPal Agent Toolkit's ${name} could not read ${READ_KIND[name]} ${id}. ${error instanceof Error ? error.message.slice(0, 200) : ""}`.trim());
    throw error;
  }
}

/** Reads a dispute through the toolkit, logged under the dispute's own records when Roomover knows them. */
export async function readDispute(db: Db, reads: PayPalReads, line: { runId: string; planId: string | null; orderId: string | null }, paypalDisputeId: string): Promise<DisputeReport> {
  const json = await toolkitRead(db, reads, line, "get_dispute", { dispute_id: paypalDisputeId }, paypalDisputeId);
  return disputeReport(paypalDisputeSchema.parse(JSON.parse(json)));
}

/** The sentence the activity panel shows when a dispute changes, in the same words as the status card. */
async function storyFor(db: Db, row: DisputeRow): Promise<{ title: string; detail: string } | null> {
  if (row.orderId === null) return null;
  const order = await loadHandoffOrderById(db, row.orderId);
  if (order === null) return null;
  const item = order.items.find((entry) => entry.orderItemId === row.orderItemId) ?? null;
  const plan = await loadSessionPlan(db as Database, order.planId, order.sessionId ?? "");
  const ref = plan === null || item === null ? undefined : layoutRefs(plan).get(item.listingId);
  return disputeWords({
    buyerFirstName: (plan?.buyerName ?? "The buyer").split(" ")[0],
    sellerFirstName: item?.sellerName.split(" ")[0] ?? "the sellers",
    noun: item === null ? null : ref === undefined ? item.title.toLowerCase() : shortNoun(ref),
    status: row.status,
    outcome: row.outcome,
    evidenceState: row.evidenceState,
    refundedCents: row.refundedCents,
    messageSent: row.messageState === "sent",
  });
}

/**
 * Lands one report of a dispute, from a webhook or a read, inside the
 * caller's transaction. Returns where it landed, and writes an activity line
 * when the dispute is new or its status moved.
 */
export async function landDisputeReport(tx: Db, report: DisputeReport, runId: string): Promise<{ step: DisputeUpdateStep; row: DisputeRow; planId: string | null }> {
  const records = await disputedRecords(tx, report.captureIds, report.listingIds);
  const before = await loadDispute(tx, report.paypalDisputeId);
  const { step, row } = await recordDisputeUpdate(tx, {
    paypalDisputeId: report.paypalDisputeId,
    status: report.status,
    stage: report.stage,
    reason: report.reason,
    amountCents: report.amountCents,
    outcome: report.outcome,
    refundedCents: report.refundedCents,
    sellerResponseDueAt: report.sellerResponseDueAt,
    updatedAt: report.updatedAt,
    records,
    evidenceDue: report.paypalStatus === "WAITING_FOR_SELLER_RESPONSE" && report.canProvideEvidence,
  });
  const planId = records?.planId ?? null;
  const moved = step === "insert" || (step === "apply" && before?.status !== row.status);
  if (moved && row.orderId !== null) {
    const story = await storyFor(tx, row);
    const summary = `Dispute ${row.paypalDisputeId} is ${report.paypalStatus}${report.stage === null ? "" : ` in ${report.stage}`}, reason ${report.reason ?? "not given"}${report.amountCents === null ? "" : `, ${(report.amountCents / 100).toFixed(2)} USD`}${report.outcome === null ? "" : `, outcome ${report.outcome}`}.`;
    const events = await insertEvents(tx, {
      runId,
      planId,
      orderId: row.orderId,
      agent: "platform",
      drafts: [{ tool: step === "insert" ? "dispute_opened" : row.status === "resolved" ? "dispute_resolved" : "dispute_updated", summary, ...(story === null ? {} : { sentence: story.title }), paypal: { api: "Disputes", id: row.paypalDisputeId }, detail: { paypalIdKind: "dispute", ...(row.amountCents === null ? {} : { priceCents: row.amountCents }) } }],
    });
    if (planId !== null) for (const event of events) publish(planId, { type: "event", event });
  }
  return { step, row, planId };
}

async function contextFor(db: Database, row: DisputeRow): Promise<DisputeContext | null> {
  if (row.orderId === null) return null;
  const order = await loadHandoffOrderById(db, row.orderId);
  if (order === null) return null;
  const plan = await loadSessionPlan(db, order.planId, order.sessionId ?? "");
  if (plan === null) return null;
  const preset = await presetFor(db, plan);
  const item = order.items.find((entry) => entry.orderItemId === row.orderItemId) ?? null;
  const ref = item === null ? undefined : layoutRefs(plan).get(item.listingId);
  const asking = await db.select({ id: listings.id, priceCents: listings.priceCents }).from(listings).where(inArray(listings.id, order.items.map((entry) => entry.listingId)));
  return {
    order,
    item,
    noun: item === null ? null : ref === undefined ? item.title.toLowerCase() : shortNoun(ref),
    buyerName: plan.buyerName,
    roomLabel: preset === null ? "the room" : roomLabel(preset, plan.roomNumber),
    askingCents: new Map(asking.map((listing) => [listing.id, listing.priceCents])),
    events: await orderEventViews(db, order.id),
  };
}

const usageDetail = (result: { usage: DisputeNoteUsage }, mode: ClaudeMode) =>
  mode === "live" ? { claudeCalls: result.usage.calls, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, cacheReadTokens: result.usage.cacheReadTokens } : { claudeCalls: 0 };

export type DisputeRunOutcome =
  | { kind: "not_ours" | "not_due" | "busy"; why: string }
  | { kind: "messaged"; message: string }
  | { kind: "sent"; bundle: EvidenceBundle }
  | { kind: "failed"; why: string };

/** A message run takes at most three calls, so it starts only while the day's allowance still covers them. */
const MESSAGE_CALLS = 3;
const SPENT_MESSAGE: InquiryMessageResult = { ok: false, error: "The day's Claude allowance is spent, so Roomover sent a message code wrote from the handoff record.", usage: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 } };

type RunLine = { runId: string; planId: string | null; orderId: string | null };

/**
 * Roomover's one message to the buyer while the dispute is an inquiry.
 * Code builds the facts from the handoff record, the verifier writes the
 * wording under the note's checks, and code adds the line about escalation.
 * Returns the message PayPal took, or null when none went out.
 */
async function sendInquiryMessage(deps: DisputeDeps, line: RunLine, row: DisputeRow, report: DisputeReport, context: DisputeContext): Promise<string | null> {
  const { db } = deps;
  const decision = decideInquiryMessage({ status: report.paypalStatus, stage: report.stage, canSendMessage: report.canSendMessage }, row.messageState);
  if (!decision.due || !(await claimMessage(db, row.id))) return null;
  const record = async (drafts: Parameters<typeof insertEvents>[1]["drafts"], agent: "verifier" | "platform") => {
    const events = await insertEvents(db, { runId: line.runId, planId: line.planId, orderId: row.orderId ?? undefined, agent, drafts });
    if (line.planId !== null) for (const event of events) publish(line.planId, { type: "event", event });
  };
  try {
    const ref = { paypalDisputeId: row.paypalDisputeId, reason: report.reason ?? "OTHER", amountCents: report.amountCents, stage: report.stage };
    const facts = noteFacts(context, ref);
    const { mode, transport } = await deps.transportFor(inquiryRecordingKey(context.item?.listingId ?? context.order.items[0].listingId, ref.reason));
    const spent = mode === "live" && (await claudeCallsToday(db, deps.now())) + MESSAGE_CALLS > RUN_LIMITS.claudeCallsPerDay;
    const written = spent ? SPENT_MESSAGE : await writeInquiryMessage(transport, facts);
    await record([{ tool: "write_inquiry_message", summary: written.ok ? `Wrote the message to the buyer for dispute ${row.paypalDisputeId}: "${written.message}"` : written.error, blocked: !written.ok, detail: usageDetail(written, mode) }], "verifier");
    const message = composeInquiryMessage(written.ok ? written.message : codeInquiryMessage(facts));
    await sendDisputeMessage(deps.rest, row.paypalDisputeId, message);
    await finishMessage(db, row.id, { sent: true, message, at: deps.now() });
    await record(
      [
        {
          tool: "send_message",
          summary: `Sent the buyer one message on dispute ${row.paypalDisputeId} through the Disputes API send-message call, ${message.length} characters.`,
          sentence: `Roomover sent ${facts.buyerFirstName} the facts from the handoff record in PayPal.`,
          paypal: { api: "Disputes", id: row.paypalDisputeId },
          detail: { paypalIdKind: "dispute" },
        },
      ],
      "platform",
    );
    return message;
  } catch (error) {
    const why = error instanceof PayPalApiError ? `PayPal refused the message (${error.status}, debug ID ${error.debugId ?? "none"}).` : error instanceof Error ? error.message.slice(0, 240) : "The message did not go out.";
    await finishMessage(db, row.id, { sent: false, error: why });
    await record([{ tool: "send_message", summary: `The message on dispute ${row.paypalDisputeId} did not go out. ${why}`, blocked: true, paypal: { api: "Disputes", id: row.paypalDisputeId }, detail: { paypalIdKind: "dispute" } }], "platform");
    return null;
  }
}

/** A note run takes at most five calls, so it starts only while the day's allowance still covers them. */
const NOTE_CALLS = 5;
const SPENT_NOTE: DisputeNoteResult = { ok: false, error: "The day's Claude allowance is spent, so Roomover sent the record with a note code wrote.", reads: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 } };

/**
 * The verifier agent's dispute run, after a webhook landed or when a script
 * asks. Safe to run twice: the claim lets one run send evidence per stage.
 */
export async function runDisputeAgent(deps: DisputeDeps, paypalDisputeId: string): Promise<DisputeRunOutcome> {
  const { db } = deps;
  const runId = randomUUID();
  const known = await loadDispute(db, paypalDisputeId);
  const line = { runId, planId: null as string | null, orderId: known?.orderId ?? null };
  if (known?.orderId !== null && known !== null) {
    const order = await loadHandoffOrderById(db, known.orderId);
    line.planId = order?.planId ?? null;
  }

  const report = await readDispute(db, deps.reads, line, paypalDisputeId);
  const landed = await db.transaction((tx) => landDisputeReport(tx, report, runId));
  const row = landed.row;
  if (row.orderId === null) return { kind: "not_ours", why: "The disputed transaction is not a Roomover capture." };
  line.orderId = row.orderId;
  line.planId = landed.planId;
  const done = () => {
    if (line.planId !== null) publish(line.planId, { type: "handoff" });
  };

  const context = await contextFor(db, row);
  const message = context === null ? null : await sendInquiryMessage(deps, line, row, report, context);
  const refundIds = context === null ? [] : (context.item === null ? context.order.items : [context.item]).flatMap((entry) => (entry.paypalRefundId === null ? [] : [entry.paypalRefundId]));
  const decision = decideEvidence(
    { status: report.paypalStatus, stage: report.stage, reason: report.reason ?? "OTHER", requested: report.requested, canProvideEvidence: report.canProvideEvidence, refundIds },
    { state: row.evidenceState, stage: row.evidenceStage },
  );
  if (!decision.due || context === null) {
    done();
    if (message !== null) return { kind: "messaged", message };
    return { kind: "not_due", why: decision.due ? "Roomover could not load the order's records." : decision.why };
  }
  if (!(await claimEvidence(db, row.id, report.stage))) return { kind: "busy", why: "Another run holds this stage's submission." };

  try {
    const ref = { paypalDisputeId, reason: report.reason ?? "OTHER", amountCents: report.amountCents, stage: report.stage };
    const facts = noteFacts(context, ref);
    const captureId = row.disputedCaptureId ?? context.item?.paypalCaptureId ?? context.order.paypalCaptureId;
    const bound: Record<PayPalReadToolName, { input: Record<string, unknown>; id: string }> = {
      get_dispute: { input: { dispute_id: paypalDisputeId }, id: paypalDisputeId },
      get_order: { input: { id: context.order.paypalOrderId ?? "" }, id: context.order.paypalOrderId ?? "none" },
      list_transactions: { input: { transaction_id: captureId ?? "", search_months: 1 }, id: captureId ?? "none" },
    };
    const key = disputeRecordingKey(context.item?.listingId ?? context.order.items[0].listingId, ref.reason);
    const { mode, transport } = await deps.transportFor(key);
    const spent = mode === "live" && (await claudeCallsToday(db, deps.now())) + NOTE_CALLS > RUN_LIMITS.claudeCallsPerDay;
    const note = spent ? SPENT_NOTE : await writeDisputeNote(transport, facts, (name) => toolkitRead(db, deps.reads, line, name, bound[name].input, bound[name].id));
    const verifierNote = note.ok ? note.note : null;
    const noteEvents = await insertEvents(db, {
      runId,
      planId: line.planId,
      orderId: row.orderId,
      agent: "verifier",
      drafts: [
        {
          tool: "write_dispute_note",
          summary: note.ok ? `Wrote the note for dispute ${paypalDisputeId} after reading ${note.reads.join(", ")}: "${note.note}"` : note.error,
          blocked: !note.ok,
          detail: usageDetail(note, mode),
        },
      ],
    });
    if (line.planId !== null) for (const event of noteEvents) publish(line.planId, { type: "event", event });

    const timeline = timelineOf(context);
    const { files, skipped } = await evidenceFiles(db, context, recordPdf(context, ref, timeline));
    const notes = composeNotes(verifierNote ?? codeNote(facts), files.length);
    const bundle = evidenceBundleSchema.parse({
      kind: decision.kind,
      evidenceType: decision.evidenceType,
      notes,
      verifierNote,
      files: files.map((file) => ({ name: file.filename, contentType: file.contentType, bytes: file.data.byteLength, source: file.source })),
      skipped,
      refundIds,
      timeline: timeline.length > 0 ? timeline : [{ at: deps.now().toISOString(), event: `Dispute ${paypalDisputeId} received.` }],
    });
    await provideDisputeEvidence(deps.rest, paypalDisputeId, { evidenceType: decision.evidenceType, notes, files, ...(decision.kind === "proof_of_refund" ? { refundIds } : {}) });
    await finishEvidence(db, row.id, { sent: true, bundle, stage: report.stage, at: deps.now() });
    const bytes = files.reduce((sum, file) => sum + file.data.byteLength, 0);
    const story = await storyFor(db, (await loadDispute(db, paypalDisputeId)) ?? row);
    const events = await insertEvents(db, {
      runId,
      planId: line.planId,
      orderId: row.orderId,
      agent: "platform",
      drafts: [
        {
          tool: "provide_evidence",
          summary: `Sent ${decision.evidenceType} evidence for dispute ${paypalDisputeId} through the Disputes API provide-evidence call: ${files.length} files, ${Math.round(bytes / 1024)} KB, ${skipped.length} left out. ${decision.why}`,
          ...(story === null ? {} : { sentence: `Roomover sent PayPal ${KIND_WORDS[decision.kind]} for the dispute.` }),
          paypal: { api: "Disputes", id: paypalDisputeId },
          detail: { paypalIdKind: "dispute", evidence: { evidenceType: decision.evidenceType, files: files.length, skipped: skipped.length, bytes } },
        },
      ],
    });
    if (line.planId !== null) for (const event of events) publish(line.planId, { type: "event", event });
    done();
    return { kind: "sent", bundle };
  } catch (error) {
    const why = error instanceof PayPalApiError ? `PayPal refused the evidence (${error.status}, debug ID ${error.debugId ?? "none"}).` : error instanceof Error ? error.message.slice(0, 240) : "The evidence did not go out.";
    await finishEvidence(db, row.id, { sent: false, error: why });
    const events = await insertEvents(db, { runId, planId: line.planId, orderId: row.orderId, agent: "platform", drafts: [{ tool: "provide_evidence", summary: `Evidence for dispute ${paypalDisputeId} did not go out. ${why}`, blocked: true, paypal: { api: "Disputes", id: paypalDisputeId }, detail: { paypalIdKind: "dispute" } }] });
    if (line.planId !== null) for (const event of events) publish(line.planId, { type: "event", event });
    done();
    return { kind: "failed", why };
  }
}
