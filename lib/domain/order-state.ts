import type { OrderItemStatus, OrderStatus, PaymentMode } from "./enums";

/**
 * The order state machine. Checkout moves an order out of pending approval
 * once, through the API answer or a webhook, whichever arrives first. At
 * handoff an order holding money either settles (captures, refunds, and the
 * payout) or is released in full by the demo release or a new plan. A
 * settlement that stopped before moving any money can still be released.
 */
const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending_approval: ["approved", "authorized", "capture_pending", "captured", "capture_declined", "canceled"],
  approved: ["authorized", "capture_pending", "captured", "capture_declined", "canceled"],
  authorized: ["settling", "releasing", "voided"],
  capture_pending: ["captured", "capture_declined"],
  captured: ["settling", "releasing", "reversed"],
  capture_declined: ["canceled"],
  settling: ["settled", "releasing"],
  releasing: ["voided", "refunded"],
  settled: [],
  canceled: [],
  voided: [],
  reversed: [],
  refunded: [],
};

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean => ORDER_TRANSITIONS[from].includes(to);

/** Where an approved checkout can land, from PayPal's answer to authorize or capture. */
export type ApprovalStatus = Extract<OrderStatus, "authorized" | "capture_pending" | "captured" | "capture_declined">;

/**
 * Whether an approval result changes the order. The same result twice is a
 * duplicate, and a result the order has already moved past (a pending
 * capture webhook after the capture completed) is stale. Both change nothing.
 */
export function approvalStep(current: OrderStatus, next: ApprovalStatus): "apply" | "duplicate" | "stale" {
  if (current === next) return "duplicate";
  return canTransition(current, next) ? "apply" : "stale";
}

/** An approval outcome must match how the order pays. Authorize mode never captures at checkout. */
export function approvalFits(mode: PaymentMode, next: ApprovalStatus): boolean {
  return mode === "authorize_then_capture" ? next === "authorized" : next !== "authorized";
}

/** What each item shows once the order lands. Items captured at checkout are held by the platform until handoff. */
export const ITEM_STATUS_AFTER: Readonly<Record<ApprovalStatus, OrderItemStatus>> = {
  authorized: "authorized",
  capture_pending: "capture_pending",
  captured: "held",
  capture_declined: "capture_declined",
};

/** Orders whose money PayPal holds for the buyer, which keep their listings reserved. */
export const MONEY_HELD_STATUSES = ["authorized", "capture_pending", "captured", "settling", "releasing"] as const satisfies readonly OrderStatus[];

export const holdsMoney = (status: OrderStatus): boolean => (MONEY_HELD_STATUSES as readonly OrderStatus[]).includes(status);

/** Orders a handoff can still check, before any money moves. */
export const CHECKABLE_STATUSES = ["authorized", "captured"] as const satisfies readonly OrderStatus[];

export const canCheck = (status: OrderStatus): boolean => (CHECKABLE_STATUSES as readonly OrderStatus[]).includes(status);

/** Where a released order ends, by how it paid. */
export const releasedStatus = (mode: PaymentMode): Extract<OrderStatus, "voided" | "refunded"> => (mode === "authorize_then_capture" ? "voided" : "refunded");

/**
 * What one approval result does to an order, whether the API answer or a
 * webhook delivers it. The listings are reserved by the first result that
 * puts money on hold, and by no later one.
 */
export function planApproval(order: { status: OrderStatus; paymentMode: PaymentMode }, next: ApprovalStatus): { step: "apply" | "duplicate" | "stale"; reserveListings: boolean } {
  const step = approvalFits(order.paymentMode, next) ? approvalStep(order.status, next) : "stale";
  return { step, reserveListings: step === "apply" && holdsMoney(next) && !holdsMoney(order.status) };
}
