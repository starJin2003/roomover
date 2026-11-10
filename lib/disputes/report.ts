import { disputeStatusFrom } from "@/lib/domain/dispute";
import type { DisputeStatus } from "@/lib/domain/enums";
import { CURRENCY, decimalToCents } from "@/lib/domain/money";
import type { PayPalDispute } from "@/lib/paypal/rest/disputes";

/** A PayPal dispute as Roomover reads it, from a toolkit read or a webhook resource. */
export interface DisputeReport {
  paypalDisputeId: string;
  /** PayPal's own status, such as WAITING_FOR_SELLER_RESPONSE. */
  paypalStatus: string;
  status: DisputeStatus;
  stage: string | null;
  reason: string | null;
  amountCents: number | null;
  outcome: string | null;
  refundedCents: number | null;
  updatedAt: Date | null;
  sellerResponseDueAt: Date | null;
  /** The platform's transactions the buyer disputes, which are captures. */
  captureIds: string[];
  /** The items the buyer picked, by the sku PayPal echoes, which is the listing ID. */
  listingIds: string[];
  requested: string[];
  canProvideEvidence: boolean;
}

const cents = (money: { currency_code: string; value: string } | undefined) => (money === undefined || money.currency_code !== CURRENCY ? null : decimalToCents(money.value));
const date = (value: string | undefined) => (value === undefined || Number.isNaN(Date.parse(value)) ? null : new Date(value));

export function disputeReport(dispute: PayPalDispute): DisputeReport {
  const paypalStatus = dispute.status ?? "OTHER";
  return {
    paypalDisputeId: dispute.dispute_id,
    paypalStatus,
    status: disputeStatusFrom(paypalStatus),
    stage: dispute.dispute_life_cycle_stage ?? null,
    reason: dispute.reason ?? null,
    amountCents: cents(dispute.dispute_amount),
    outcome: dispute.dispute_outcome?.outcome_code ?? null,
    refundedCents: cents(dispute.dispute_outcome?.amount_refunded),
    updatedAt: date(dispute.update_time),
    sellerResponseDueAt: date(dispute.seller_response_due_date),
    captureIds: (dispute.disputed_transactions ?? []).flatMap((transaction) => (transaction.seller_transaction_id === undefined ? [] : [transaction.seller_transaction_id])),
    listingIds: (dispute.disputed_transactions ?? []).flatMap((transaction) => (transaction.items ?? []).flatMap((item) => (item.item_id === undefined ? [] : [item.item_id]))),
    requested: (dispute.evidences ?? []).flatMap((evidence) => (evidence.source === "REQUESTED_FROM_SELLER" && evidence.evidence_type !== undefined ? [evidence.evidence_type] : [])),
    canProvideEvidence: (dispute.links ?? []).some((link) => link.rel === "provide_evidence" || link.rel === "provide-evidence"),
  };
}

/** A webhook resource that lacks what the state needs, so Roomover reads the dispute itself. */
export function reportIsComplete(dispute: PayPalDispute): boolean {
  return dispute.status !== undefined && dispute.reason !== undefined && dispute.update_time !== undefined && (dispute.disputed_transactions ?? []).some((transaction) => transaction.seller_transaction_id !== undefined);
}
