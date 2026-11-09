import type { PaymentMode } from "./enums";
import { sumCents } from "./money";

/**
 * How a checked handoff becomes PayPal calls. Money moves once every item
 * has a confirmed decision, in one pass that each step keys to its own
 * record, so a retried pass skips what already landed and never moves
 * money twice.
 */

/** PayPal honors an authorization in full for 3 days. After that a capture may find the funds gone. */
export const HONOR_PERIOD_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const AUTHORIZATION_DAYS = 29;

export interface SettlementLine {
  orderItemId: string;
  sellerId: string;
  /** What the order holds for the item, its listed price. */
  amountCents: number;
  /** What the student agreed to pay at handoff. */
  payCents: number;
  /** Set once the item's capture landed (authorize mode). */
  captureId: string | null;
  /** Set once the item's refund landed (capture mode). */
  refundId: string | null;
}

export interface SettlementOrder {
  paymentMode: PaymentMode;
  /** When PayPal authorized the order, which starts the honor period. */
  approvedAt: Date;
  reauthorizedAt: Date | null;
  /** True once the remaining hold was voided. */
  voided: boolean;
}

export type SettlementStep =
  | { kind: "reauthorize"; amountCents: number }
  | { kind: "capture"; orderItemId: string; amountCents: number; finalCapture: boolean }
  | { kind: "void" }
  | { kind: "refund"; orderItemId: string; amountCents: number };

function assertLines(lines: readonly SettlementLine[]): void {
  if (lines.length === 0) throw new RangeError("A settlement needs at least one item.");
  for (const line of lines) {
    if (!Number.isSafeInteger(line.payCents) || line.payCents < 0 || line.payCents > line.amountCents) {
      throw new RangeError(`Item ${line.orderItemId} pays ${line.payCents} of ${line.amountCents} cents.`);
    }
  }
}

/**
 * Roomover reauthorizes at most once, and only when captures still have to
 * run after the honor period and inside the 29 days PayPal keeps an
 * authorization.
 */
export function needsReauthorization(order: Pick<SettlementOrder, "approvedAt" | "reauthorizedAt">, now: Date): boolean {
  const age = now.getTime() - order.approvedAt.getTime();
  return order.reauthorizedAt === null && age > HONOR_PERIOD_DAYS * DAY_MS && age < AUTHORIZATION_DAYS * DAY_MS;
}

/**
 * The PayPal calls still to make, in order. Authorize mode captures each
 * paid item from the authorization, marks the last capture final so PayPal
 * releases the rest of the hold, and voids the hold when nothing is left
 * to capture. Capture mode refunds what each item gives back from the one
 * checkout capture.
 */
export function settlementSteps(order: SettlementOrder, lines: readonly SettlementLine[], now: Date): SettlementStep[] {
  assertLines(lines);
  if (order.paymentMode === "capture_at_checkout") {
    return lines.flatMap((line): SettlementStep[] =>
      line.payCents < line.amountCents && line.refundId === null ? [{ kind: "refund", orderItemId: line.orderItemId, amountCents: line.amountCents - line.payCents }] : [],
    );
  }

  const paid = lines.filter((line) => line.payCents > 0);
  if (paid.length === 0) return order.voided ? [] : [{ kind: "void" }];
  const last = paid[paid.length - 1].orderItemId;
  const open = paid.filter((line) => line.captureId === null);
  const steps: SettlementStep[] = [];
  if (open.length > 0 && open.length === paid.length && needsReauthorization(order, now)) {
    steps.push({ kind: "reauthorize", amountCents: sumCents(paid.map((line) => line.payCents)) });
  }
  for (const line of open) steps.push({ kind: "capture", orderItemId: line.orderItemId, amountCents: line.payCents, finalCapture: line.orderItemId === last });
  return steps;
}

export interface SellerPayoutLine {
  sellerId: string;
  amountCents: number;
  orderItemIds: string[];
}

/** One payout line per seller who keeps money, summing their items, in the order sellers first appear. */
export function payoutLines(lines: readonly Pick<SettlementLine, "orderItemId" | "sellerId" | "payCents">[]): SellerPayoutLine[] {
  const bySeller = new Map<string, SellerPayoutLine>();
  for (const line of lines) {
    if (line.payCents <= 0) continue;
    const entry = bySeller.get(line.sellerId) ?? { sellerId: line.sellerId, amountCents: 0, orderItemIds: [] };
    entry.amountCents = sumCents([entry.amountCents, line.payCents]);
    entry.orderItemIds.push(line.orderItemId);
    bySeller.set(line.sellerId, entry);
  }
  return [...bySeller.values()];
}

export interface SettlementTotals {
  heldCents: number;
  paidCents: number;
  releasedCents: number;
}

export function settlementTotals(lines: readonly Pick<SettlementLine, "amountCents" | "payCents">[]): SettlementTotals {
  const heldCents = sumCents(lines.map((line) => line.amountCents));
  const paidCents = sumCents(lines.map((line) => line.payCents));
  return { heldCents, paidCents, releasedCents: heldCents - paidCents };
}
