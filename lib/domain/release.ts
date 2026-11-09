import type { OrderStatus } from "./enums";
import { canCheck } from "./order-state";

const HOUR_MS = 60 * 60 * 1000;

/**
 * The demo release. A judge who pays and never checks an item would keep
 * five listings off the catalog for good, because sandbox authorizations
 * never expire. An hourly job gives the money back on demo orders whose
 * handoff did not start within 2 hours of approval and puts the listings
 * back on sale. The student starts a handoff with the first photo.
 */
export const DEMO_HOLD_MS = 2 * HOUR_MS;

/**
 * A handoff that started and then saw nothing for this long is released the
 * same way. Money moves only at the last confirmation, so an order still
 * holding its whole payment has captured nothing for any item yet.
 */
export const IDLE_HANDOFF_MS = 6 * HOUR_MS;

export interface ReleaseCandidate {
  status: OrderStatus;
  approvedAt: Date | null;
  /** Handoff photos the student took for the order's items. */
  photoCount: number;
  /** The latest change to any of the order's handoffs, such as a photo, a verdict, or a confirmation. */
  lastActivityAt: Date | null;
}

export type ReleaseReason = "demo_hold" | "idle_handoff";

/** Why the hourly job releases an order now, or null when it stays. */
export function releaseReason(order: ReleaseCandidate, now: Date): ReleaseReason | null {
  if (!canCheck(order.status) || order.approvedAt === null) return null;
  if (order.photoCount === 0) return now.getTime() - order.approvedAt.getTime() >= DEMO_HOLD_MS ? "demo_hold" : null;
  const since = order.lastActivityAt ?? order.approvedAt;
  return now.getTime() - since.getTime() >= IDLE_HANDOFF_MS ? "idle_handoff" : null;
}

/**
 * PayPal lets a payer approve an order for 6 hours after it is created. A
 * prepared order older than that can never be paid, and the release job
 * cancels it, so the daily reseed no longer skips the listings it names.
 */
export const APPROVAL_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * Listings a demo session created on Sell leave the catalog this long after
 * they were listed, so judges' test items do not pile up for later judges.
 */
export const SELL_LISTING_TTL_MS = 24 * HOUR_MS;

export interface SellListingCandidate {
  createdAt: Date;
  /** An order that has not reached a terminal status names this listing. */
  inOpenOrder: boolean;
  /** Any order, plan, or negotiation names this listing, so its row stays as history. */
  referenced: boolean;
}

/** What cleanup does with a Sell listing: nothing yet, delete it, or withdraw it where history still names it. */
export function sellListingCleanup(listing: SellListingCandidate, now: Date): "keep" | "delete" | "withdraw" {
  if (listing.inOpenOrder || now.getTime() - listing.createdAt.getTime() < SELL_LISTING_TTL_MS) return "keep";
  return listing.referenced ? "withdraw" : "delete";
}
