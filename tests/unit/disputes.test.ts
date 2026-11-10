import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { writeDisputeNote, type DisputeNoteFacts } from "@/lib/agents/verifier/dispute";
import type { VerifierRequest } from "@/lib/agents/verifier/compare";
import { textPdf } from "@/lib/disputes/pdf";
import { disputeReport, reportIsComplete } from "@/lib/disputes/report";
import {
  checkEvidenceFiles,
  decideEvidence,
  DISPUTE_REASONS,
  disputeNoteSchema,
  disputeStatusFrom,
  disputeUpdateStep,
  disputeWords,
  EVIDENCE_LIMITS,
  evidenceStateOnReport,
  noteProblems,
  type DisputeFacts,
} from "@/lib/domain/dispute";
import { paypalDisputeSchema } from "@/lib/paypal/rest/disputes";
import { webhookResourceId } from "@/lib/paypal/webhooks/events";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

const waiting: DisputeFacts = { status: "WAITING_FOR_SELLER_RESPONSE", stage: "INQUIRY", reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", requested: [], canProvideEvidence: true, refundIds: [] };
const fresh = { state: "due" as const, stage: null };

describe("decideEvidence", () => {
  it.each([
    ["RESOLVED", "The dispute is resolved."],
    ["WAITING_FOR_BUYER_RESPONSE", "PayPal is waiting for the buyer."],
    ["UNDER_REVIEW", "PayPal is reviewing the dispute."],
    ["OPEN", "PayPal has not asked the seller for evidence."],
    ["OTHER", "PayPal has not asked the seller for evidence."],
  ])("owes nothing while the dispute is %s", (status, why) => {
    expect(decideEvidence({ ...waiting, status }, fresh)).toEqual({ due: false, why });
  });

  it("owes nothing without PayPal's provide-evidence link, while a submission is out, or once this stage has one", () => {
    expect(decideEvidence({ ...waiting, canProvideEvidence: false }, fresh)).toMatchObject({ due: false, why: "PayPal offers no provide-evidence link on the dispute right now." });
    expect(decideEvidence(waiting, { state: "sending", stage: null })).toMatchObject({ due: false });
    expect(decideEvidence(waiting, { state: "sent", stage: "INQUIRY" })).toMatchObject({ due: false, why: "Roomover already sent evidence for the INQUIRY stage." });
    expect(decideEvidence({ ...waiting, stage: "CHARGEBACK" }, { state: "sent", stage: "INQUIRY" })).toMatchObject({ due: true });
    expect(decideEvidence(waiting, { state: "failed", stage: null })).toMatchObject({ due: true });
  });

  it.each(DISPUTE_REASONS.map((reason) => [reason]))("picks the evidence for %s", (reason) => {
    const decision = decideEvidence({ ...waiting, reason }, fresh);
    const expected = reason === "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED" ? { kind: "item_description", evidenceType: "ITEM_DESCRIPTION" } : { kind: "handoff_record", evidenceType: "OTHER" };
    expect(decision).toMatchObject({ due: true, ...expected });
  });

  it("sends the refund IDs for a missing credit only when Roomover refunded the item", () => {
    expect(decideEvidence({ ...waiting, reason: "CREDIT_NOT_PROCESSED", refundIds: ["3LJ1"] }, fresh)).toMatchObject({ kind: "proof_of_refund", evidenceType: "PROOF_OF_REFUND" });
    expect(decideEvidence({ ...waiting, reason: "INCORRECT_AMOUNT", refundIds: ["3LJ1"] }, fresh)).toMatchObject({ kind: "proof_of_refund" });
    expect(decideEvidence({ ...waiting, reason: "CREDIT_NOT_PROCESSED" }, fresh)).toMatchObject({ kind: "handoff_record" });
  });

  it("uses the type PayPal requested when Roomover can back it, never a shipping proof it cannot have", () => {
    expect(decideEvidence({ ...waiting, reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", requested: ["PROOF_OF_FULFILLMENT", "PROOF_OF_DELIVERY_SIGNATURE"] }, fresh)).toMatchObject({
      due: true,
      kind: "handoff_record",
      evidenceType: "PROOF_OF_DELIVERY_SIGNATURE",
      why: "PayPal asked the seller for PROOF_OF_DELIVERY_SIGNATURE.",
    });
    expect(decideEvidence({ ...waiting, requested: ["PROOF_OF_FULFILLMENT", "PROOF_OF_REFUND"] }, fresh)).toMatchObject({ evidenceType: "ITEM_DESCRIPTION" });
  });
});

describe("evidence files", () => {
  const file = (name: string, bytes: number, contentType = "image/jpeg") => ({ name, bytes, contentType });

  it("keeps JPEG, PNG, GIF, and PDF files with PayPal's names, under 10 MB each", () => {
    const { accepted, skipped } = checkEvidenceFiles([
      file("handoff photo 1, chair.jpg", 80_000),
      file("handoff record.pdf", 3_000, "application/pdf"),
      file("listing photo 1, chair.webp", 50_000, "image/webp"),
      file("photo #2.jpg", 1_000),
      file("huge.png", EVIDENCE_LIMITS.fileBytes, "image/png"),
      file("tiny.gif", 900, "image/gif"),
    ]);
    expect(accepted.map((entry) => entry.name)).toEqual(["handoff photo 1, chair.jpg", "handoff record.pdf", "tiny.gif"]);
    expect(skipped).toEqual([
      { name: "listing photo 1, chair.webp", reason: "PayPal takes JPEG, PNG, GIF, or PDF files." },
      { name: "photo #2.jpg", reason: "PayPal does not accept that file name." },
      { name: "huge.png", reason: "Each file must be under 10 MB." },
    ]);
  });

  it("stops at 50 MB in one call and at 10 files", () => {
    const big = Array.from({ length: 6 }, (_, index) => file(`big ${index}.jpg`, 9 * 1024 * 1024));
    expect(checkEvidenceFiles(big).accepted).toHaveLength(5);
    const many = Array.from({ length: 12 }, (_, index) => file(`photo ${index}.jpg`, 1_000));
    const checked = checkEvidenceFiles(many);
    expect(checked.accepted).toHaveLength(EVIDENCE_LIMITS.files);
    expect(checked.skipped.at(-1)?.reason).toBe("A bundle holds at most 10 files.");
  });
});

describe("the verifier's note", () => {
  const note = "Jordan bought the mesh desk chair from Marcus and checked it in person at handoff. Jordan's own photo showed a new tear in the seat, and Jordan kept the chair at $30 of $35.";

  it("validates length and names only amounts code gave", () => {
    expect(disputeNoteSchema.safeParse({ note }).success).toBe(true);
    expect(disputeNoteSchema.safeParse({ note: "Too short." }).success).toBe(false);
    expect(disputeNoteSchema.safeParse({ note: "x".repeat(701) }).success).toBe(false);
    expect(disputeNoteSchema.safeParse({ note, extra: true }).success).toBe(false);
    expect(noteProblems(note, [3_500, 3_000])).toEqual([]);
    expect(noteProblems("Jordan paid $30.00 and later asked for 40 dollars.", [3_500, 3_000])).toEqual(["The note names 40 dollars, which is not one of the amounts given ($35, $30). Use only those amounts or none."]);
  });

  const facts: DisputeNoteFacts = {
    buyerFirstName: "Jordan",
    sellerFirstName: "Marcus",
    itemTitle: "Black mesh back rolling desk chair",
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    disputedCents: 3_000,
    askingCents: 3_500,
    agreedCents: 3_500,
    paidCents: 3_000,
    handoff: "The chair was handed over in person in Harbor Hall 214, and Jordan photographed it there.",
    finding: "The verifier found a new 3 cm tear. Jordan kept the chair at handoff and paid $30 of $35.",
  };

  const message = (content: unknown[]): BetaMessage => ({ id: "msg", type: "message", role: "assistant", model: "claude-sonnet-5-5", content, stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }) as unknown as BetaMessage;
  const use = (id: string, name: string, input: unknown = {}) => ({ type: "tool_use", id, name, input });

  function scripted(replies: BetaMessage[]) {
    const requests: VerifierRequest[] = [];
    return { requests, transport: { send: async (request: VerifierRequest) => (requests.push(structuredClone(request)), replies.shift() as BetaMessage) } };
  }

  it("reads through the bound toolkit tools, then writes one note", async () => {
    const { transport, requests } = scripted([message([use("a", "get_dispute"), use("b", "get_order"), use("c", "list_transactions")]), message([use("d", "write_dispute_note", { note })])]);
    const read = vi.fn(async (name: string) => JSON.stringify({ read: name }));
    const result = await writeDisputeNote(transport, facts, read);
    expect(result).toMatchObject({ ok: true, note, reads: ["get_dispute", "get_order", "list_transactions"], usage: { calls: 2 } });
    expect(read.mock.calls.map(([name]) => name)).toEqual(["get_dispute", "get_order", "list_transactions"]);
    expect(String(requests[0].messages[0].content)).toContain("Amounts the note may name: $35, $30.");
  });

  it("refuses a note before the order is read and a note with an amount code did not give, with one retry", async () => {
    const early = scripted([message([use("a", "write_dispute_note", { note })]), message([use("b", "get_order")]), message([use("c", "write_dispute_note", { note })])]);
    expect(await writeDisputeNote(early.transport, facts, async () => "{}")).toMatchObject({ ok: true, reads: ["get_order"] });
    const bad = { note: `${note} The buyer also wants $40 back.` };
    const twice = scripted([message([use("a", "get_order")]), message([use("b", "write_dispute_note", bad)]), message([use("c", "write_dispute_note", bad)])]);
    expect(await writeDisputeNote(twice.transport, facts, async () => "{}")).toMatchObject({ ok: false, usage: { calls: 3 } });
  });

  it("answers a tool outside the allowlist with an error and never runs it", async () => {
    const { transport } = scripted([message([use("a", "accept_dispute_claim", { note: "ok" }), use("b", "get_order")]), message([use("c", "write_dispute_note", { note })])]);
    const read = vi.fn(async (name: string) => JSON.stringify({ name }));
    expect(await writeDisputeNote(transport, facts, read)).toMatchObject({ ok: true });
    expect(read.mock.calls.map(([name]) => name)).toEqual(["get_order"]);
  });
});

describe("dispute state", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 9, 20, minute));

  it("orders reports by PayPal's update time and keeps a resolved dispute resolved", () => {
    expect(disputeUpdateStep(null, { status: "waiting_for_seller_response", updatedAt: at(1) })).toBe("insert");
    const held = { status: "waiting_for_seller_response" as const, paypalUpdatedAt: at(5) };
    expect(disputeUpdateStep(held, { status: "under_review", updatedAt: at(6) })).toBe("apply");
    expect(disputeUpdateStep(held, { status: "open", updatedAt: at(4) })).toBe("stale");
    expect(disputeUpdateStep(held, { status: "waiting_for_seller_response", updatedAt: at(5) })).toBe("same");
    expect(disputeUpdateStep({ status: "resolved", paypalUpdatedAt: at(5) }, { status: "under_review", updatedAt: at(9) })).toBe("stale");
  });

  it("makes evidence due when PayPal waits for the seller, and due again at a later stage", () => {
    expect(evidenceStateOnReport(null, { evidenceDue: true, stage: "INQUIRY" })).toBe("due");
    expect(evidenceStateOnReport(null, { evidenceDue: false, stage: "INQUIRY" })).toBe("not_due");
    expect(evidenceStateOnReport({ state: "sent", stage: "INQUIRY" }, { evidenceDue: true, stage: "INQUIRY" })).toBe("sent");
    expect(evidenceStateOnReport({ state: "sent", stage: "INQUIRY" }, { evidenceDue: true, stage: "CHARGEBACK" })).toBe("due");
    expect(evidenceStateOnReport({ state: "sending", stage: null }, { evidenceDue: true, stage: "INQUIRY" })).toBe("sending");
    expect(evidenceStateOnReport({ state: "failed", stage: null }, { evidenceDue: false, stage: "INQUIRY" })).toBe("failed");
  });

  it("maps PayPal's statuses and reads a webhook resource", () => {
    expect(disputeStatusFrom("WAITING_FOR_SELLER_RESPONSE")).toBe("waiting_for_seller_response");
    expect(disputeStatusFrom("SOMETHING_NEW")).toBe("other");
    const resource = paypalDisputeSchema.parse({
      dispute_id: "PP-D-27803",
      reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
      status: "WAITING_FOR_SELLER_RESPONSE",
      dispute_life_cycle_stage: "INQUIRY",
      dispute_amount: { currency_code: "USD", value: "30.00" },
      update_time: "2026-11-09T20:05:00.000Z",
      disputed_transactions: [{ seller_transaction_id: "8YE464155G502411H", buyer_transaction_id: "1AB" }],
      evidences: [{ evidence_type: "PROOF_OF_DELIVERY_SIGNATURE", source: "REQUESTED_FROM_SELLER" }, { evidence_type: "OTHER", source: "SUBMITTED_BY_BUYER" }],
      links: [{ href: "https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-27803/provide-evidence", rel: "provide_evidence", method: "POST" }],
    });
    expect(reportIsComplete(resource)).toBe(true);
    expect(disputeReport(resource)).toMatchObject({ status: "waiting_for_seller_response", stage: "INQUIRY", amountCents: 3_000, captureIds: ["8YE464155G502411H"], requested: ["PROOF_OF_DELIVERY_SIGNATURE"], canProvideEvidence: true });
    expect(reportIsComplete({ dispute_id: "PP-D-27803" })).toBe(false);
    expect(webhookResourceId({ id: "WH-1", event_type: "CUSTOMER.DISPUTE.CREATED", create_time: "2026-11-09T20:05:00Z", resource: { dispute_id: "PP-D-27803" } })).toBe("PP-D-27803");
  });

  it("says where a dispute stands in plain words", () => {
    const story = { buyerFirstName: "Jordan", sellerFirstName: "Marcus", noun: "chair", status: "waiting_for_seller_response" as const, outcome: null, evidenceState: "sent" as const, refundedCents: null };
    expect(disputeWords(story)).toEqual({ title: "Jordan opened a dispute about the chair.", detail: "Roomover sent PayPal the photos and the handoff record." });
    expect(disputeWords({ ...story, evidenceState: "not_due", status: "waiting_for_buyer_response" }).detail).toBe("PayPal is waiting for Jordan's reply.");
    expect(disputeWords({ ...story, status: "resolved", outcome: "RESOLVED_BUYER_FAVOUR", refundedCents: 3_000 })).toEqual({ title: "PayPal refunded Jordan $30 for the chair.", detail: "Marcus keeps the payout, and Roomover covers the refund." });
    expect(disputeWords({ ...story, status: "resolved", outcome: "RESOLVED_SELLER_FAVOUR" }).title).toBe("PayPal closed the dispute about the chair in Marcus's favor.");
  });
});

describe("the handoff record PDF", () => {
  it("writes a PDF 1.4 file with escaped text and plain ASCII", () => {
    const pdf = new TextDecoder().decode(textPdf("Roomover handoff record", ["Item: chair (mesh) \\ “quoted” – dash", "x ".repeat(400)]));
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain("(Item: chair \\(mesh\\) \\\\ \"quoted\" - dash) Tj");
    expect(/[^\x00-\x7F]/.test(pdf)).toBe(false);
    expect(pdf).toMatch(/xref\n0 \d+\n0000000000 65535 f/);
  });
});
