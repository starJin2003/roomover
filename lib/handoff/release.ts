import { publish } from "@/lib/agents/bus";
import { roomLabel } from "@/lib/agents/buyer/run";
import type { Database } from "@/lib/db/client";
import { cancelUnapprovedBefore, claimRelease, finishRelease, insertHandoffEvents, loadHandoffOrderById, nextOrderAttempt, releaseCandidates, stoppedSettlements } from "@/lib/db/handoffs";
import { loadSessionPlan } from "@/lib/db/plans";
import { removeSellListings, sellListingsBefore } from "@/lib/db/sell";
import { APPROVAL_WINDOW_MS, DEMO_HOLD_MS, releaseReason, SELL_LISTING_TTL_MS, sellListingCleanup, settlementMovedMoney, STOPPED_SETTLEMENT_MS, type ReleaseReason as HoldReleaseReason } from "@/lib/domain/release";
import { formatUsdShort } from "@/lib/format";
import { PayPalApiError } from "@/lib/paypal/errors";
import { refundKey, voidKey } from "@/lib/paypal/idempotency";
import type { PayPalRestClient } from "@/lib/paypal/rest/client";
import { issueOf, keyedWrite } from "@/lib/paypal/retry";
import type { PayPalSdk } from "@/lib/paypal/server-sdk/client";
import { refundCapture, voidAuthorization } from "@/lib/paypal/server-sdk/payments";
import { layoutRefs, presetFor } from "./load";
import { settleHandoff } from "./settle";

export interface ReleaseDeps {
  db: Database;
  sdk: PayPalSdk;
  now: () => Date;
}

/** The hourly job also carries stopped settlements on, which pay sellers through Payouts. */
export interface ReleaseJobDeps extends ReleaseDeps {
  rest: PayPalRestClient;
}

/** Why the hourly job gives money back: the hold went unused, the handoff sat idle, or a settlement stopped before moving money. */
export type JobReleaseReason = HoldReleaseReason | "stopped_settlement";

/** Why the money goes back, from the hourly job or because the student started a new plan. */
export type ReleaseReason = JobReleaseReason | "new_plan";

const SENTENCES: Readonly<Record<ReleaseReason, Record<"voided" | "refunded", (total: string) => string>>> = {
  demo_hold: {
    voided: (total) => `PayPal released your ${total} hold, because no item was checked within 2 hours. Nothing was charged.`,
    refunded: (total) => `Roomover refunded your ${total}, because no item was checked within 2 hours.`,
  },
  idle_handoff: {
    voided: (total) => `PayPal released your ${total} hold, because the handoff saw no activity for 6 hours. Nothing was charged.`,
    refunded: (total) => `Roomover refunded your ${total}, because the handoff saw no activity for 6 hours.`,
  },
  stopped_settlement: {
    voided: (total) => `PayPal released your ${total} hold, because the handoff could not settle within an hour. Nothing was charged.`,
    refunded: (total) => `Roomover refunded your ${total}, because the handoff could not settle within an hour.`,
  },
  new_plan: {
    voided: (total) => `You started a new plan, so PayPal released your ${total} hold. Nothing was charged.`,
    refunded: (total) => `You started a new plan, so Roomover refunded your ${total}.`,
  },
};

const SUMMARY_REASON: Readonly<Record<ReleaseReason, string>> = {
  demo_hold: "the demo release after 2 hours without a handoff",
  idle_handoff: "the demo release after a handoff sat idle for 6 hours",
  stopped_settlement: "the demo release after a settlement stopped for an hour before moving any money",
  new_plan: "a new plan",
};

/**
 * Gives all of an unchecked order's money back and puts its listings on
 * sale again. Authorize mode voids the authorization and capture mode
 * refunds the capture, each with a key derived from the order, so a release
 * that stopped partway finishes on the next try without moving money twice.
 * Returns false when the order is not holding money or a settlement owns it,
 * except a stopped settlement the hourly job hands over.
 */
export async function releaseOrder(deps: ReleaseDeps, orderId: string, reason: ReleaseReason): Promise<boolean> {
  if (!(await claimRelease(deps.db, orderId, { fromSettling: reason === "stopped_settlement" }))) return false;
  const order = await loadHandoffOrderById(deps.db, orderId);
  if (order === null) return false;
  const total = formatUsdShort(order.totalCents);
  let paypal: { api: string; id: string; kind: "authorization" | "refund" };
  if (order.paymentMode === "authorize_then_capture") {
    const authorization = order.paypalReauthorizationId ?? order.paypalAuthorizationId;
    if (authorization === null) throw new Error(`Order ${orderId} has no authorization to void.`);
    await keyedWrite(
      () => voidAuthorization(deps.sdk, authorization, voidKey(order.id, order.attempt)),
      () => nextOrderAttempt(deps.db, order.id, order.attempt),
    );
    paypal = { api: "Payments v2", id: authorization, kind: "authorization" };
  } else {
    const captureId = order.paypalCaptureId;
    if (captureId === null) throw new Error(`Order ${orderId} has no capture to refund.`);
    const refund = await keyedWrite(
      () => refundCapture(deps.sdk, captureId, {}, refundKey(order.id, order.attempt)),
      () => nextOrderAttempt(deps.db, order.id, order.attempt),
    );
    paypal = { api: "Payments v2", id: refund.id ?? captureId, kind: refund.id === undefined ? "authorization" : "refund" };
  }
  await finishRelease(deps.db, orderId, { at: deps.now(), planStatus: reason === "new_plan" ? "abandoned" : "ready" });
  const ended = order.paymentMode === "authorize_then_capture" ? "voided" : "refunded";
  await insertHandoffEvents(deps.db, order, "platform", [
    {
      tool: "release_order",
      sentence: SENTENCES[reason][ended](total),
      summary: `${ended === "voided" ? "Voided" : "Refunded"} ${total} for ${SUMMARY_REASON[reason]}, and put ${order.items.length} listings back on sale.`,
      detail: { totalCents: order.totalCents, paypalIdKind: paypal.kind },
      paypal: { api: paypal.api, id: paypal.id },
    },
  ]);
  publish(order.planId, { type: "handoff" });
  return true;
}

export interface ReleaseReport {
  released: { orderId: string; reason: JobReleaseReason }[];
  /** Stopped settlements the job carried on to the end. */
  resumed: string[];
  /** Prepared orders past PayPal's approval window, canceled so the reseed refreshes their listings. */
  canceled: string[];
  /** Listings demo sessions made on Sell a day ago or more. */
  sell: { deleted: number; withdrawn: number; drafts: number; photos: number };
  failed: { orderId: string; error: string }[];
}

/**
 * Takes listings demo sessions made on Sell off the catalog a day after they
 * were listed, unless an open order names them. A listing nothing else
 * names is deleted with its photo, and one an order or a plan still names
 * is withdrawn. Drafts nobody listed go with their photos.
 */
async function removeOldSellListings(deps: ReleaseDeps, now: Date): Promise<ReleaseReport["sell"]> {
  const cutoff = new Date(now.getTime() - SELL_LISTING_TTL_MS);
  const deleteIds: string[] = [];
  const withdrawIds: string[] = [];
  for (const listing of await sellListingsBefore(deps.db, cutoff)) {
    const action = sellListingCleanup(listing, now);
    if (action === "delete") deleteIds.push(listing.id);
    if (action === "withdraw") withdrawIds.push(listing.id);
  }
  return removeSellListings(deps.db, { deleteIds, withdrawIds, draftsBefore: cutoff });
}

const failure = (error: unknown): string =>
  error instanceof PayPalApiError ? `${error.status} ${issueOf(error) ?? error.errorName ?? ""}`.trim() : error instanceof Error ? error.name : "unknown";

/**
 * Carries on a settlement that stopped and saw no change for an hour, with
 * the same steps and keys the student's Try again would use. When it stops
 * again before any money moved, the order is released in full so the
 * listings go back on sale. When money already moved, it stays settling
 * and the next run tries again.
 */
async function finishStoppedSettlements(deps: ReleaseJobDeps, now: Date, report: ReleaseReport): Promise<void> {
  for (const stopped of await stoppedSettlements(deps.db, new Date(now.getTime() - STOPPED_SETTLEMENT_MS))) {
    try {
      const plan = stopped.sessionId === null ? null : await loadSessionPlan(deps.db, stopped.planId, stopped.sessionId);
      const preset = plan === null ? null : await presetFor(deps.db, plan);
      if (plan === null || preset === null) throw new Error(`Order ${stopped.id} has no plan or room preset to settle against.`);
      await settleHandoff(deps, plan.id, roomLabel(preset, plan.roomNumber), layoutRefs(plan));
      report.resumed.push(stopped.id);
    } catch (error) {
      const order = await loadHandoffOrderById(deps.db, stopped.id);
      try {
        if (order !== null && !settlementMovedMoney(order) && (await releaseOrder(deps, stopped.id, "stopped_settlement"))) {
          report.released.push({ orderId: stopped.id, reason: "stopped_settlement" });
          continue;
        }
      } catch (releaseError) {
        report.failed.push({ orderId: stopped.id, error: failure(releaseError) });
        continue;
      }
      report.failed.push({ orderId: stopped.id, error: failure(error) });
    }
  }
}

/**
 * The hourly demo release. It gives the money back on paid orders whose
 * handoff never started within 2 hours, or started and then sat idle for 6,
 * finishes any release a stopped run left partway, carries on settlements
 * that stopped an hour ago, cancels prepared orders nobody can approve
 * anymore, and clears day old Sell listings.
 */
export async function releaseStaleOrders(deps: ReleaseJobDeps): Promise<ReleaseReport> {
  const now = deps.now();
  const canceled = await cancelUnapprovedBefore(deps.db, new Date(now.getTime() - APPROVAL_WINDOW_MS));
  const candidates = await releaseCandidates(deps.db, new Date(now.getTime() - DEMO_HOLD_MS));
  const report: ReleaseReport = { released: [], resumed: [], canceled, sell: await removeOldSellListings(deps, now), failed: [] };
  for (const candidate of candidates) {
    const reason = candidate.status === "releasing" ? "demo_hold" : releaseReason(candidate, now);
    if (reason === null) continue;
    try {
      if (await releaseOrder(deps, candidate.id, reason)) report.released.push({ orderId: candidate.id, reason });
    } catch (error) {
      report.failed.push({ orderId: candidate.id, error: failure(error) });
    }
  }
  await finishStoppedSettlements(deps, now, report);
  return report;
}
