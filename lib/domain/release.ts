import type { OrderStatus } from "./enums";
import { canCheck } from "./order-state";

/**
 * The demo release. A judge who pays and never checks an item would keep
 * five listings off the catalog for good, because sandbox authorizations
 * never expire. An hourly job gives the money back on demo orders whose
 * handoff did not start within 2 hours of approval and puts the listings
 * back on sale. The student starts a handoff with the first photo.
 */
export const DEMO_HOLD_MS = 2 * 60 * 60 * 1000;

export interface ReleaseCandidate {
  status: OrderStatus;
  approvedAt: Date | null;
  /** Handoff photos the student took for the order's items. */
  photoCount: number;
}

export function releaseDue(order: ReleaseCandidate, now: Date): boolean {
  if (!canCheck(order.status) || order.approvedAt === null || order.photoCount > 0) return false;
  return now.getTime() - order.approvedAt.getTime() >= DEMO_HOLD_MS;
}

/**
 * PayPal lets a payer approve an order for 6 hours after it is created. A
 * prepared order older than that can never be paid, and the release job
 * cancels it, so the daily reseed no longer skips the listings it names.
 */
export const APPROVAL_WINDOW_MS = 6 * 60 * 60 * 1000;
