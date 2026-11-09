import type { HandoffMode, ListingStatus, PaymentMode } from "./enums";
import { checkoutPaymentMode, handoffWindow, type MoveWindows, type TimeWindow } from "./handoff";
import { isSlotShape, slotInside } from "./handoff-slots";
import { sumCents } from "./money";

/** A listing as checkout reads it from Postgres, with the plan's agreed terms when its agents settled on some. */
export interface CheckoutListing extends MoveWindows {
  id: string;
  title: string;
  sellerId: string;
  sellerName: string;
  priceCents: number;
  floorPriceCents: number;
  handoffMode: HandoffMode;
  status: ListingStatus;
  agreement: { priceCents: number; slot: TimeWindow } | null;
}

export interface CheckoutLine {
  listingId: string;
  sellerId: string;
  sellerName: string;
  title: string;
  amountCents: number;
  /** The listed price, which the line is below when the agents agreed on less. */
  listPriceCents: number;
  handoff: TimeWindow;
  /** The handoff slot the agents agreed on, or null when the line keeps the whole handoff window. */
  slot: TimeWindow | null;
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
 * The agreed terms checkout stands behind. Code checks them again here, so
 * an agreement that no longer fits the listing (a changed price, a moved
 * window) falls back to the listed price and the whole window.
 */
export function standingAgreement(listing: CheckoutListing, handoff: TimeWindow): { priceCents: number; slot: TimeWindow } | null {
  const agreement = listing.agreement;
  if (agreement === null) return null;
  const priceOk = Number.isSafeInteger(agreement.priceCents) && agreement.priceCents >= listing.floorPriceCents && agreement.priceCents <= listing.priceCents;
  const slotOk = isSlotShape(agreement.slot) && slotInside(agreement.slot, handoff);
  return priceOk && slotOk ? agreement : null;
}

/**
 * Turns the listings in a plan into one order. Every amount is the listed
 * price or the price the agents agreed on within the seller's floor, and the
 * payment mode follows from the agreed slots or the handoff windows, so
 * nothing the model writes reaches PayPal unchecked. Lines keep the plan's
 * order.
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
    const agreed = standingAgreement(listing, handoff);
    return {
      listingId: id,
      sellerId: listing.sellerId,
      sellerName: listing.sellerName,
      title: listing.title,
      amountCents: agreed?.priceCents ?? listing.priceCents,
      listPriceCents: listing.priceCents,
      handoff,
      slot: agreed !== null && agreed.slot.endsAt > checkoutAt ? agreed.slot : null,
    };
  });

  return {
    lines,
    totalCents: sumCents(lines.map((line) => line.amountCents)),
    sellerCount: new Set(lines.map((line) => line.sellerId)).size,
    paymentMode: checkoutPaymentMode(
      checkoutAt,
      lines.map((line) => line.slot ?? line.handoff),
    ),
  };
}

/** PayPal intent for a payment mode. Authorize holds the money until handoff, capture takes it now. */
export const intentFor = (mode: PaymentMode): "AUTHORIZE" | "CAPTURE" => (mode === "authorize_then_capture" ? "AUTHORIZE" : "CAPTURE");

type LineKey = Pick<CheckoutLine, "listingId" | "amountCents" | "slot">;

/** True when an order's lines are exactly what the plan holds now, at the same prices and slots. */
export function sameLines(a: readonly LineKey[], b: readonly LineKey[]): boolean {
  const key = (lines: readonly LineKey[]) =>
    lines
      .map((line) => `${line.listingId}:${line.amountCents}:${line.slot?.startsAt.getTime() ?? "window"}`)
      .sort()
      .join("|");
  return key(a) === key(b);
}
