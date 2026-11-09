import type { HandoffMode, ListingStatus, PaymentMode } from "./enums";
import { checkoutPaymentMode, handoffWindow, type MoveWindows, type TimeWindow } from "./handoff";
import { sumCents } from "./money";

/** A listing as checkout reads it from Postgres. The price is the listed price in cents. */
export interface CheckoutListing extends MoveWindows {
  id: string;
  title: string;
  sellerId: string;
  sellerName: string;
  priceCents: number;
  handoffMode: HandoffMode;
  status: ListingStatus;
}

export interface CheckoutLine {
  listingId: string;
  sellerId: string;
  sellerName: string;
  title: string;
  amountCents: number;
  handoff: TimeWindow;
}

export interface CheckoutPlan {
  lines: CheckoutLine[];
  totalCents: number;
  sellerCount: number;
  paymentMode: PaymentMode;
}

/** Why a plan cannot become an order. Each reason carries a sentence the student and the agent can act on. */
export class CheckoutRefused extends Error {
  constructor(
    readonly reason: "empty" | "unavailable" | "no_handoff" | "paid",
    message: string,
    readonly listingIds: readonly string[] = [],
  ) {
    super(message);
    this.name = "CheckoutRefused";
  }
}

/**
 * Turns the listings in a plan into one order. Every amount is the listed
 * price, and the payment mode follows from the handoff windows, so nothing
 * the model writes reaches PayPal. Lines keep the plan's order.
 */
export function buildCheckout(listingIds: readonly string[], listings: ReadonlyMap<string, CheckoutListing>, checkoutAt: Date): CheckoutPlan {
  if (listingIds.length === 0) throw new CheckoutRefused("empty", "The room has no items to pay for yet.");
  const missing = listingIds.filter((id) => listings.get(id)?.status !== "active");
  if (missing.length > 0) {
    const titles = missing.map((id) => listings.get(id)?.title ?? "An item").join(", ");
    throw new CheckoutRefused("unavailable", `${titles} ${missing.length === 1 ? "is" : "are"} no longer available. Replace or remove ${missing.length === 1 ? "it" : "them"} first.`, missing);
  }

  const lines = listingIds.map((id): CheckoutLine => {
    const listing = listings.get(id) as CheckoutListing;
    const handoff = handoffWindow(listing.handoffMode, listing);
    if (handoff === null || handoff.endsAt <= checkoutAt) {
      throw new CheckoutRefused("no_handoff", `${listing.title} has no handoff time left before move in.`, [id]);
    }
    return { listingId: id, sellerId: listing.sellerId, sellerName: listing.sellerName, title: listing.title, amountCents: listing.priceCents, handoff };
  });

  return {
    lines,
    totalCents: sumCents(lines.map((line) => line.amountCents)),
    sellerCount: new Set(lines.map((line) => line.sellerId)).size,
    paymentMode: checkoutPaymentMode(
      checkoutAt,
      lines.map((line) => line.handoff),
    ),
  };
}

/** PayPal intent for a payment mode. Authorize holds the money until handoff, capture takes it now. */
export const intentFor = (mode: PaymentMode): "AUTHORIZE" | "CAPTURE" => (mode === "authorize_then_capture" ? "AUTHORIZE" : "CAPTURE");

/** True when an order's lines are exactly what the plan holds now, at the same prices. */
export function sameLines(a: readonly Pick<CheckoutLine, "listingId" | "amountCents">[], b: readonly Pick<CheckoutLine, "listingId" | "amountCents">[]): boolean {
  const key = (lines: readonly Pick<CheckoutLine, "listingId" | "amountCents">[]) =>
    lines
      .map((line) => `${line.listingId}:${line.amountCents}`)
      .sort()
      .join("|");
  return key(a) === key(b);
}
