import { publish } from "@/lib/agents/bus";
import type { Database } from "@/lib/db/client";
import { cancelUnapprovedBefore, claimRelease, finishRelease, insertHandoffEvents, loadHandoffOrderById, releaseCandidates } from "@/lib/db/handoffs";
import { APPROVAL_WINDOW_MS, DEMO_HOLD_MS, releaseDue } from "@/lib/domain/release";
import { formatUsdShort } from "@/lib/format";
import { PayPalApiError } from "@/lib/paypal/errors";
import { refundKey, voidKey } from "@/lib/paypal/idempotency";
import { issueOf, retryTransient } from "@/lib/paypal/retry";
import type { PayPalSdk } from "@/lib/paypal/server-sdk/client";
import { refundCapture, voidAuthorization } from "@/lib/paypal/server-sdk/payments";

export interface ReleaseDeps {
  db: Database;
  sdk: PayPalSdk;
  now: () => Date;
}

/** Why the money goes back. A demo hold ran out without a handoff, or the student started a new plan. */
export type ReleaseReason = "demo_hold" | "new_plan";

const SENTENCES: Readonly<Record<ReleaseReason, Record<"voided" | "refunded", (total: string) => string>>> = {
  demo_hold: {
    voided: (total) => `PayPal released your ${total} hold, because no item was checked within 2 hours. Nothing was charged.`,
    refunded: (total) => `Roomover refunded your ${total}, because no item was checked within 2 hours.`,
  },
  new_plan: {
    voided: (total) => `You started a new plan, so PayPal released your ${total} hold. Nothing was charged.`,
    refunded: (total) => `You started a new plan, so Roomover refunded your ${total}.`,
  },
};

/**
 * Gives all of an unchecked order's money back and puts its listings on
 * sale again. Authorize mode voids the authorization and capture mode
 * refunds the capture, each with a key derived from the order, so a release
 * that stopped partway finishes on the next try without moving money twice.
 * Returns false when the order is not holding money or a settlement owns it.
 */
export async function releaseOrder(deps: ReleaseDeps, orderId: string, reason: ReleaseReason): Promise<boolean> {
  if (!(await claimRelease(deps.db, orderId))) return false;
  const order = await loadHandoffOrderById(deps.db, orderId);
  if (order === null) return false;
  const total = formatUsdShort(order.totalCents);
  let paypal: { api: string; id: string; kind: "authorization" | "refund" };
  if (order.paymentMode === "authorize_then_capture") {
    const authorization = order.paypalReauthorizationId ?? order.paypalAuthorizationId;
    if (authorization === null) throw new Error(`Order ${orderId} has no authorization to void.`);
    await retryTransient(() => voidAuthorization(deps.sdk, authorization, voidKey(order.id, order.attempt)));
    paypal = { api: "Payments v2", id: authorization, kind: "authorization" };
  } else {
    const captureId = order.paypalCaptureId;
    if (captureId === null) throw new Error(`Order ${orderId} has no capture to refund.`);
    const refund = await retryTransient(() => refundCapture(deps.sdk, captureId, {}, refundKey(order.id, order.attempt)));
    paypal = { api: "Payments v2", id: refund.id ?? captureId, kind: refund.id === undefined ? "authorization" : "refund" };
  }
  await finishRelease(deps.db, orderId, { at: deps.now(), planStatus: reason === "new_plan" ? "abandoned" : "ready" });
  const ended = order.paymentMode === "authorize_then_capture" ? "voided" : "refunded";
  await insertHandoffEvents(deps.db, order, "platform", [
    {
      tool: "release_order",
      sentence: SENTENCES[reason][ended](total),
      summary: `${ended === "voided" ? "Voided" : "Refunded"} ${total} for ${reason === "demo_hold" ? "the demo release after 2 hours without a handoff" : "a new plan"}, and put ${order.items.length} listings back on sale.`,
      detail: { totalCents: order.totalCents, paypalIdKind: paypal.kind },
      paypal: { api: paypal.api, id: paypal.id },
    },
  ]);
  publish(order.planId, { type: "handoff" });
  return true;
}

export interface ReleaseReport {
  released: string[];
  /** Prepared orders past PayPal's approval window, canceled so the reseed refreshes their listings. */
  canceled: string[];
  failed: { orderId: string; error: string }[];
}

/**
 * The hourly demo release. It also finishes any release a stopped run left
 * partway, never touches an order whose handoff started, and cancels
 * prepared orders nobody can approve anymore.
 */
export async function releaseStaleOrders(deps: ReleaseDeps): Promise<ReleaseReport> {
  const now = deps.now();
  const canceled = await cancelUnapprovedBefore(deps.db, new Date(now.getTime() - APPROVAL_WINDOW_MS));
  const candidates = await releaseCandidates(deps.db, new Date(now.getTime() - DEMO_HOLD_MS));
  const report: ReleaseReport = { released: [], canceled, failed: [] };
  for (const candidate of candidates) {
    if (candidate.status !== "releasing" && !releaseDue(candidate, now)) continue;
    try {
      if (await releaseOrder(deps, candidate.id, "demo_hold")) report.released.push(candidate.id);
    } catch (error) {
      report.failed.push({ orderId: candidate.id, error: error instanceof PayPalApiError ? `${error.status} ${issueOf(error) ?? error.errorName ?? ""}`.trim() : error instanceof Error ? error.name : "unknown" });
    }
  }
  return report;
}
