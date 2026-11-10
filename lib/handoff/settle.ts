import { z } from "zod";
import { publish } from "@/lib/agents/bus";
import type { Database } from "@/lib/db/client";
import {
  claimSettlement,
  finishSettlement,
  hasOrderEvent,
  insertHandoffEvents,
  loadHandoffOrder,
  loadHandoffOrderById,
  nextItemAttempt,
  nextOrderAttempt,
  recordItemCapture,
  recordItemRefund,
  recordReauthorization,
  recordSettlementError,
  recordVoided,
  type HandoffOrder,
} from "@/lib/db/handoffs";
import { settlementSteps, settlementTotals, type SettlementStep } from "@/lib/domain/settlement";
import { formatUsdShort } from "@/lib/format";
import { PayPalApiError } from "@/lib/paypal/errors";
import { captureKey, reauthorizeKey, refundKey, voidKey } from "@/lib/paypal/idempotency";
import type { PayPalRestClient } from "@/lib/paypal/rest/client";
import { issueOf, keyedWrite } from "@/lib/paypal/retry";
import type { PayPalSdk } from "@/lib/paypal/server-sdk/client";
import { captureAuthorization, reauthorizeAuthorization, refundCapture, voidAuthorization } from "@/lib/paypal/server-sdk/payments";
import { HandoffRefused } from "./check";
import { refreshPayout, sendPayout } from "./payouts";
import { moneyBackSentence, firstNameOf, shortNoun, type ItemWords } from "./words";
import type { LayoutRef } from "./view";

export interface SettleDeps {
  db: Database;
  sdk: PayPalSdk;
  rest: PayPalRestClient;
  now: () => Date;
}

const paymentSchema = z.object({ id: z.string().min(1), status: z.string().optional() });

/** A settlement that stopped partway, with the sentence the student sees. A retry picks up where it stopped. */
export class SettlementStopped extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementStopped";
  }
}

const STOPPED = "PayPal did not finish settling your handoff. Nothing was charged twice. Press Try again.";

function wordsOf(item: HandoffOrder["items"][number], layout: ReadonlyMap<string, LayoutRef>): ItemWords {
  const ref = layout.get(item.listingId);
  return { sellerFirstName: firstNameOf(item.sellerName), noun: ref === undefined ? item.title.toLowerCase() : shortNoun(ref), priceCents: item.amountCents };
}

/** Runs one PayPal step and records what it returned before the next one starts. */
async function runStep(deps: SettleDeps, order: HandoffOrder, step: SettlementStep, layout: ReadonlyMap<string, LayoutRef>): Promise<HandoffOrder> {
  const { db, sdk } = deps;
  const authorization = order.paypalReauthorizationId ?? order.paypalAuthorizationId;
  const item = "orderItemId" in step ? order.items.find((candidate) => candidate.orderItemId === step.orderItemId) : undefined;
  switch (step.kind) {
    case "reauthorize": {
      if (authorization === null) throw new SettlementStopped(STOPPED);
      const answer = paymentSchema.parse(
        await keyedWrite(
          () => reauthorizeAuthorization(sdk, authorization, { amountCents: step.amountCents }, reauthorizeKey(order.id, order.attempt)),
          () => nextOrderAttempt(db, order.id, order.attempt),
        ),
      );
      await recordReauthorization(db, order.id, answer.id, deps.now());
      await insertHandoffEvents(db, order, "platform", [
        {
          tool: "reauthorize",
          sentence: `PayPal renewed the ${formatUsdShort(step.amountCents)} hold, because the 3 day honor period had passed.`,
          summary: `Reauthorized ${authorization} for ${formatUsdShort(step.amountCents)} as ${answer.id}, once, after the honor period.`,
          detail: { totalCents: step.amountCents, paypalIdKind: "reauthorization" },
          paypal: { api: "Payments v2", id: answer.id },
        },
      ]);
      break;
    }
    case "capture": {
      if (authorization === null || item === undefined) throw new SettlementStopped(STOPPED);
      const answer = paymentSchema.parse(
        await keyedWrite(
          () => captureAuthorization(sdk, authorization, { amountCents: step.amountCents, finalCapture: step.finalCapture }, captureKey(item.orderItemId, item.attempt)),
          () => nextItemAttempt(db, item.orderItemId, item.attempt),
        ),
      );
      if (answer.status !== "COMPLETED" && answer.status !== "PENDING") {
        // A declined capture is PayPal's answer to this key, so the next try needs a new one.
        await nextItemAttempt(db, item.orderItemId, item.attempt);
        const words = wordsOf(item, layout);
        throw new SettlementStopped(`PayPal declined the charge for ${words.sellerFirstName}'s ${words.noun}. Nothing else was charged. Press Try again.`);
      }
      await recordItemCapture(db, { orderItemId: item.orderItemId, captureId: answer.id, amountCents: item.amountCents, payCents: step.amountCents, pending: answer.status === "PENDING" });
      await insertHandoffEvents(db, order, "platform", [
        {
          tool: "capture_item",
          summary: `Captured ${formatUsdShort(step.amountCents)} of the ${formatUsdShort(item.amountCents)} held for ${item.title}${step.finalCapture ? " with final_capture true, which releases the rest of the hold" : ""}. Status ${answer.status}.`,
          detail: { orderItemId: item.orderItemId, listingId: item.listingId, priceCents: step.amountCents, paypalIdKind: "capture" },
          paypal: { api: "Payments v2", id: answer.id },
        },
      ]);
      break;
    }
    case "void": {
      if (authorization === null) throw new SettlementStopped(STOPPED);
      await keyedWrite(
        () => voidAuthorization(sdk, authorization, voidKey(order.id, order.attempt)),
        () => nextOrderAttempt(db, order.id, order.attempt),
      );
      await recordVoided(db, order.id, deps.now());
      await insertHandoffEvents(db, order, "platform", [
        {
          tool: "void_authorization",
          sentence: `PayPal released your ${formatUsdShort(order.totalCents)} hold, so nothing was charged.`,
          summary: `Voided authorization ${authorization}, since no item was kept.`,
          detail: { totalCents: order.totalCents, paypalIdKind: "authorization" },
          paypal: { api: "Payments v2", id: authorization },
        },
      ]);
      break;
    }
    case "refund": {
      if (order.paypalCaptureId === null || item === undefined) throw new SettlementStopped(STOPPED);
      const captureId = order.paypalCaptureId;
      const answer = paymentSchema.parse(
        await keyedWrite(
          () => refundCapture(sdk, captureId, { amountCents: step.amountCents }, refundKey(item.orderItemId, item.attempt)),
          () => nextItemAttempt(db, item.orderItemId, item.attempt),
        ),
      );
      await recordItemRefund(db, { orderItemId: item.orderItemId, refundId: answer.id, amountCents: item.amountCents, payCents: item.amountCents - step.amountCents });
      await insertHandoffEvents(db, order, "platform", [
        {
          tool: "refund_item",
          summary: `Refunded ${formatUsdShort(step.amountCents)} of ${item.title} from capture ${captureId}. Status ${answer.status ?? "unknown"}.`,
          detail: { orderItemId: item.orderItemId, listingId: item.listingId, priceCents: step.amountCents, paypalIdKind: "refund" },
          paypal: { api: "Payments v2", id: answer.id },
        },
      ]);
      break;
    }
  }
  const fresh = await loadHandoffOrderById(db, order.id);
  if (fresh === null) throw new SettlementStopped(STOPPED);
  return fresh;
}

/** The sentences that close the money part: what PayPal kept for the sellers and what came back to the student. */
async function noteSettled(deps: SettleDeps, order: HandoffOrder, layout: ReadonlyMap<string, LayoutRef>): Promise<void> {
  const totals = settlementTotals(order.items.map((item) => ({ amountCents: item.amountCents, payCents: item.handoff?.payCents ?? 0 })));
  const kept = order.items.filter((item) => (item.handoff?.payCents ?? 0) > 0);
  const capture = order.paymentMode === "capture_at_checkout";
  const lead =
    totals.paidCents === 0
      ? null
      : capture
        ? `Roomover keeps ${formatUsdShort(totals.paidCents)} of your payment for ${kept.length === 1 ? "1 item" : `${kept.length} items`}.`
        : `PayPal captured ${formatUsdShort(totals.paidCents)} for ${kept.length === 1 ? "1 item" : `${kept.length} items`}.`;
  const back = order.items.flatMap((item) => {
    const released = item.amountCents - (item.handoff?.payCents ?? 0);
    if (released <= 0 || (!capture && totals.paidCents === 0)) return [];
    return [{ tool: "money_back", sentence: moneyBackSentence(wordsOf(item, layout), released, item.handoff?.report?.damage ?? null, (item.handoff?.payCents ?? 0) > 0), summary: `${formatUsdShort(released)} of ${item.title} went back to the student${capture ? " as a refund" : " when the hold closed"}.`, detail: { orderItemId: item.orderItemId, priceCents: released } }];
  });
  await insertHandoffEvents(deps.db, order, "platform", [
    { tool: "money_settled", ...(lead === null ? {} : { sentence: lead }), summary: `Settled ${formatUsdShort(totals.paidCents)} of ${formatUsdShort(totals.heldCents)} held, ${formatUsdShort(totals.releasedCents)} back to the student.`, detail: { totalCents: totals.paidCents } },
    ...back,
  ]);
}

/**
 * Moves the money once every item is confirmed. Each PayPal step keys to
 * its own record and lands in Postgres before the next one, the payout
 * follows in one batch, and the order closes as settled. A failure leaves
 * the order settling with a sentence, and the next call carries on.
 */
export async function settleHandoff(deps: SettleDeps, planId: string, roomLabel: string, layout: ReadonlyMap<string, LayoutRef>): Promise<void> {
  const { db } = deps;
  const loaded = await loadHandoffOrder(db, planId);
  if (loaded === null) throw new HandoffRefused(404, "This room has no paid order to hand off.");
  if (loaded.status === "settled") return;
  if (loaded.items.some((item) => item.handoff?.payCents === null || item.handoff?.payCents === undefined)) throw new HandoffRefused(409, "Check every item before PayPal settles.");
  if (!(await claimSettlement(db, loaded.id))) throw new HandoffRefused(409, "This order is not holding money anymore.");
  publish(planId, { type: "handoff" });

  let order = (await loadHandoffOrderById(db, loaded.id)) as HandoffOrder;
  try {
    const placed = (listingId: string) => layout.get(listingId)?.index ?? Number.MAX_SAFE_INTEGER;
    const lines = [...order.items].sort((a, b) => placed(a.listingId) - placed(b.listingId)).map((item) => ({ orderItemId: item.orderItemId, sellerId: item.sellerId, amountCents: item.amountCents, payCents: item.handoff?.payCents ?? 0, captureId: item.paypalCaptureId, refundId: item.paypalRefundId }));
    const steps = settlementSteps({ paymentMode: order.paymentMode, approvedAt: order.approvedAt ?? deps.now(), reauthorizedAt: order.reauthorizedAt, voided: order.voidedAt !== null }, lines, deps.now());
    for (const step of steps) {
      order = await runStep(deps, order, step, layout);
      publish(planId, { type: "handoff" });
    }
    if (!(await hasOrderEvent(db, order.id, "money_settled"))) await noteSettled(deps, order, layout);
    await sendPayout(deps, order, roomLabel);
    order = (await loadHandoffOrderById(db, order.id)) as HandoffOrder;
    await finishSettlement(db, order, deps.now());
  } catch (error) {
    const sentence = error instanceof SettlementStopped ? error.message : STOPPED;
    console.error("handoff settlement stopped", {
      orderId: order.id,
      error: error instanceof Error ? error.name : "unknown",
      ...(error instanceof PayPalApiError ? { status: error.status, issue: issueOf(error), debugId: error.debugId } : {}),
    });
    await recordSettlementError(db, order.id, sentence);
    publish(planId, { type: "handoff" });
    throw new SettlementStopped(sentence);
  }
  publish(planId, { type: "handoff" });
  await refreshPayout(deps, order.id).catch(() => undefined);
}
