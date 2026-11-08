import type {
  DisputeStatus,
  ListingStatus,
  OrderItemStatus,
  PaymentMode,
  PayoutItemStatus,
} from "@/lib/domain/enums";

/**
 * How a state reads at a glance. `moved` is money that has moved and `held`
 * is money PayPal holds or is about to move, so both carry PayPal blue.
 * `released` went back to the buyer without a transfer, and `alert` needs
 * someone to act.
 */
export type StatusTone = "neutral" | "held" | "moved" | "released" | "alert";

export interface StatusDisplay {
  readonly label: string;
  readonly tone: StatusTone;
}

export const LISTING_STATUS_DISPLAY: Readonly<Record<ListingStatus, StatusDisplay>> = {
  draft: { label: "Draft", tone: "neutral" },
  active: { label: "Listed", tone: "neutral" },
  reserved: { label: "Reserved", tone: "neutral" },
  sold: { label: "Sold", tone: "neutral" },
  withdrawn: { label: "Withdrawn", tone: "released" },
};

const ORDER_ITEM_STATUS_DISPLAY: Readonly<Record<Exclude<OrderItemStatus, "released">, StatusDisplay>> = {
  pending: { label: "Awaiting approval", tone: "neutral" },
  authorized: { label: "Authorized", tone: "held" },
  held: { label: "Captured and held", tone: "held" },
  capture_pending: { label: "Capture pending", tone: "held" },
  captured: { label: "Captured", tone: "moved" },
  adjusted: { label: "Partially captured", tone: "moved" },
  capture_declined: { label: "Capture declined", tone: "alert" },
  reversed: { label: "Reversed", tone: "alert" },
};

/**
 * A released item goes back to the buyer through a void when the order
 * authorized at checkout and through a refund when it captured at checkout.
 */
export function orderItemStatusDisplay(status: OrderItemStatus, paymentMode: PaymentMode): StatusDisplay {
  if (status === "released") {
    return paymentMode === "authorize_then_capture"
      ? { label: "Voided", tone: "released" }
      : { label: "Refunded", tone: "moved" };
  }
  return ORDER_ITEM_STATUS_DISPLAY[status];
}

export const PAYOUT_ITEM_STATUS_DISPLAY: Readonly<Record<PayoutItemStatus, StatusDisplay>> = {
  pending: { label: "Payout pending", tone: "held" },
  succeeded: { label: "Paid out", tone: "moved" },
  held: { label: "Payout on hold", tone: "held" },
  unclaimed: { label: "Unclaimed", tone: "held" },
  canceled: { label: "Payout canceled", tone: "released" },
  refunded: { label: "Payout refunded", tone: "alert" },
  returned: { label: "Payout returned", tone: "alert" },
  failed: { label: "Payout failed", tone: "alert" },
  blocked: { label: "Payout blocked", tone: "alert" },
  reversed: { label: "Payout reversed", tone: "alert" },
};

export const DISPUTE_STATUS_DISPLAY: Readonly<Record<DisputeStatus, StatusDisplay>> = {
  open: { label: "Disputed", tone: "alert" },
  waiting_for_buyer_response: { label: "Disputed, buyer to respond", tone: "alert" },
  waiting_for_seller_response: { label: "Disputed, evidence due", tone: "alert" },
  under_review: { label: "Dispute under review", tone: "alert" },
  other: { label: "Disputed", tone: "alert" },
  resolved: { label: "Dispute resolved", tone: "neutral" },
};
