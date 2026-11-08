import { sumCents } from "@/lib/domain/money";

export interface PayoutLine {
  readonly payoutItemId: string;
  readonly amountCents: number;
}

export interface SellersPaidProgress<T extends PayoutLine> {
  /** Rows in display order. `paidOrder` is 1 for the first payout event, null until paid. */
  readonly rows: readonly (T & { readonly paidOrder: number | null })[];
  readonly paidCount: number;
  readonly paidCents: number;
  readonly totalCents: number;
  readonly allPaid: boolean;
}

/**
 * Turns payout events, in the order they arrived, into what the sellers paid
 * list shows. Rows fill in arrival order while keeping their display order.
 * A repeated or unknown payout item ID changes nothing, because PayPal can
 * deliver the same webhook more than once.
 */
export function sellersPaidProgress<T extends PayoutLine>(lines: readonly T[], arrivals: readonly string[]): SellersPaidProgress<T> {
  const known = new Set(lines.map((line) => line.payoutItemId));
  const order = new Map<string, number>();
  for (const id of arrivals) {
    if (known.has(id) && !order.has(id)) order.set(id, order.size + 1);
  }
  const rows = lines.map((line) => ({ ...line, paidOrder: order.get(line.payoutItemId) ?? null }));
  return {
    rows,
    paidCount: order.size,
    paidCents: sumCents(rows.filter((row) => row.paidOrder !== null).map((row) => row.amountCents)),
    totalCents: sumCents(lines.map((line) => line.amountCents)),
    allPaid: lines.length > 0 && order.size === lines.length,
  };
}
