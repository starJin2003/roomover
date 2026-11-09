import type { PayoutItemStatus, PayoutStatus } from "./enums";

/**
 * Payout states as PayPal reports them, through webhooks and through the
 * batch read that backs them up. Both paths land through the same
 * transitions, so a repeated event changes nothing and an event that
 * arrives after a later one is ignored.
 */

const ITEM_TRANSITIONS: Readonly<Record<PayoutItemStatus, readonly PayoutItemStatus[]>> = {
  pending: ["succeeded", "failed", "blocked", "canceled", "held", "refunded", "returned", "unclaimed", "reversed"],
  held: ["succeeded", "failed", "blocked", "canceled", "returned", "unclaimed"],
  // An unclaimed payout succeeds when the receiver claims it, or returns after 30 days.
  unclaimed: ["succeeded", "returned", "canceled"],
  succeeded: ["refunded", "reversed"],
  failed: [],
  blocked: [],
  canceled: [],
  refunded: [],
  returned: [],
  reversed: [],
};

export function payoutItemStep(current: PayoutItemStatus, next: PayoutItemStatus): "apply" | "duplicate" | "stale" {
  if (current === next) return "duplicate";
  return ITEM_TRANSITIONS[current].includes(next) ? "apply" : "stale";
}

/** The status each PAYMENT.PAYOUTS-ITEM webhook reports. */
export const PAYOUT_ITEM_EVENT_STATUS = {
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": "succeeded",
  "PAYMENT.PAYOUTS-ITEM.FAILED": "failed",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED": "blocked",
  "PAYMENT.PAYOUTS-ITEM.CANCELED": "canceled",
  "PAYMENT.PAYOUTS-ITEM.HELD": "held",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED": "refunded",
  "PAYMENT.PAYOUTS-ITEM.RETURNED": "returned",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": "unclaimed",
} as const satisfies Record<string, PayoutItemStatus>;

/** PayPal's `transaction_status` on a payout item. Unknown values read as pending. */
const TRANSACTION_STATUS: Readonly<Record<string, PayoutItemStatus>> = {
  SUCCESS: "succeeded",
  FAILED: "failed",
  PENDING: "pending",
  UNCLAIMED: "unclaimed",
  RETURNED: "returned",
  ONHOLD: "held",
  BLOCKED: "blocked",
  REFUNDED: "refunded",
  REVERSED: "reversed",
};

export const itemStatusFromPayPal = (value: string | undefined): PayoutItemStatus => TRANSACTION_STATUS[value ?? ""] ?? "pending";

const BATCH_ORDER: readonly PayoutStatus[] = ["created", "pending", "processing", "success"];
const BATCH_FINAL: readonly PayoutStatus[] = ["success", "denied", "canceled"];

/** PayPal's `batch_status`. Unknown values read as processing. */
export function batchStatusFromPayPal(value: string | undefined): PayoutStatus {
  const status = (value ?? "").toLowerCase();
  return ([...BATCH_ORDER, ...BATCH_FINAL] as readonly string[]).includes(status) ? (status as PayoutStatus) : "processing";
}

export function payoutBatchStep(current: PayoutStatus, next: PayoutStatus): "apply" | "duplicate" | "stale" {
  if (current === next) return "duplicate";
  if (BATCH_FINAL.includes(current)) return "stale";
  if (BATCH_FINAL.includes(next)) return "apply";
  return BATCH_ORDER.indexOf(next) > BATCH_ORDER.indexOf(current) ? "apply" : "stale";
}

/** A batch PayPal finished, whether it paid or was denied or canceled. */
export const payoutBatchFinal = (status: PayoutStatus): boolean => BATCH_FINAL.includes(status);

/** Items still waiting on PayPal. An unclaimed item can wait 30 days, so the screen stops waiting for it. */
export const payoutItemWaiting = (status: PayoutItemStatus): boolean => status === "pending" || status === "held";

/** The seller row fills in PayPal blue only when the money reached their account. */
export const payoutItemPaid = (status: PayoutItemStatus): boolean => status === "succeeded";
