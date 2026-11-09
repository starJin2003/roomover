import { z } from "zod";
import type { NegotiationStatus } from "./enums";
import type { TimeWindow } from "./handoff";
import { isSlotShape, overlapOf, slotInside } from "./handoff-slots";
import { allocateByWeight, sumCents } from "./money";

/**
 * Negotiation between the buyer agent and a seller agent over price and
 * handoff slot, for one listing or a bundle of one seller's listings. Every
 * term is checked here in code: a price never goes below the seller's floor
 * or above the asking price, a slot sits inside every window it serves, and
 * a negotiation ends after three rounds. A round is one buyer offer and the
 * seller agent's answer.
 */

export const NEGOTIATION_ROUND_LIMIT = 3;
export const BUNDLE_MAX_ITEMS = 4;

/** One structured message between the buyer agent and a seller agent. */
export const offerSchema = z.strictObject({
  round: z.number().int().positive(),
  from: z.enum(["buyer", "seller"]),
  action: z.enum(["offer", "counter", "accept", "decline"]),
  priceCents: z.number().int().positive().optional(),
  handoffSlot: z
    .strictObject({ startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }) })
    .refine((slot) => Date.parse(slot.endsAt) > Date.parse(slot.startsAt), "A slot must end after it starts.")
    .optional(),
  bundleListingIds: z.array(z.uuid()).min(1).optional(),
  message: z.string().min(1),
  /** Set when code changed the seller agent's answer to keep it inside the seller's floor, the asking price, or the windows. */
  heldByCode: z.string().min(1).optional(),
  at: z.iso.datetime({ offset: true }),
});

export const offersLogSchema = z.array(offerSchema);

export type Offer = z.infer<typeof offerSchema>;
export type OffersLog = z.infer<typeof offersLogSchema>;

/** A listing as negotiation reads it. The floor stays in code and in the seller agent's prompt, never in the buyer's view. */
export interface NegotiableListing {
  id: string;
  title: string;
  sellerId: string;
  sellerName: string;
  priceCents: number;
  floorPriceCents: number;
  /** When the item can change hands, or null when the seller's and buyer's windows never meet. */
  window: TimeWindow | null;
}

export interface Terms {
  priceCents: number;
  slot: TimeWindow;
}

export interface NegotiationState {
  status: NegotiationStatus;
  /** Rounds started so far. */
  round: number;
  /** The buyer's offer waiting for the seller agent. */
  offer: Terms | null;
  /** The seller agent's counter waiting for the buyer agent. */
  counter: Terms | null;
  agreed: Terms | null;
}

export const NEW_NEGOTIATION: NegotiationState = { status: "open", round: 0, offer: null, counter: null, agreed: null };

export type NegotiationEvent =
  | { kind: "buyer_offer"; terms: Terms }
  | { kind: "seller_accept" }
  | { kind: "seller_counter"; terms: Terms }
  | { kind: "seller_decline" }
  | { kind: "buyer_accept" }
  | { kind: "buyer_decline" }
  | { kind: "cancel" };

export type Transition = { ok: true; state: NegotiationState } | { ok: false; problem: string };

const refuse = (problem: string): Transition => ({ ok: false, problem });

/**
 * The negotiation state machine. A buyer offer opens a round while rounds
 * remain, the seller agent answers that offer, and the buyer agent accepts
 * or declines a counter. A third round that ends without agreement reaches
 * the round limit. Agreed terms change only by canceling, which happens
 * when the item leaves the plan.
 */
export function advance(state: NegotiationState, event: NegotiationEvent): Transition {
  if (event.kind === "cancel") {
    return state.status === "canceled" ? refuse("This negotiation is already canceled.") : { ok: true, state: { ...state, status: "canceled", offer: null, counter: null } };
  }
  switch (state.status) {
    case "agreed":
      return refuse("These terms are already agreed.");
    case "round_limit_reached":
      return refuse(`All ${NEGOTIATION_ROUND_LIMIT} rounds are used, so the asking price stands.`);
    case "canceled":
    case "declined":
    case "open":
      break;
  }
  switch (event.kind) {
    case "buyer_offer":
      if (state.offer !== null) return refuse("The seller agent has not answered the last offer yet.");
      if (state.round >= NEGOTIATION_ROUND_LIMIT) return refuse(`All ${NEGOTIATION_ROUND_LIMIT} rounds are used, so the asking price stands.`);
      return { ok: true, state: { ...state, status: "open", round: state.round + 1, offer: event.terms, counter: null } };
    case "seller_accept":
      if (state.offer === null) return refuse("There is no offer to accept.");
      return { ok: true, state: { ...state, status: "agreed", agreed: state.offer, offer: null, counter: null } };
    case "seller_counter":
      if (state.offer === null) return refuse("There is no offer to counter.");
      return { ok: true, state: { ...state, offer: null, counter: event.terms } };
    case "seller_decline":
      if (state.offer === null) return refuse("There is no offer to decline.");
      return { ok: true, state: { ...state, status: state.round >= NEGOTIATION_ROUND_LIMIT ? "round_limit_reached" : "open", offer: null, counter: null } };
    case "buyer_accept":
      if (state.counter === null) return refuse("There is no counter to accept.");
      return { ok: true, state: { ...state, status: "agreed", agreed: state.counter, counter: null } };
    case "buyer_decline":
      if (state.counter === null) return refuse("There is no counter to decline.");
      return { ok: true, state: { ...state, status: state.round >= NEGOTIATION_ROUND_LIMIT ? "round_limit_reached" : "declined", counter: null } };
  }
}

const toTerms = (offer: Offer): Terms | null =>
  offer.priceCents === undefined || offer.handoffSlot === undefined
    ? null
    : { priceCents: offer.priceCents, slot: { startsAt: new Date(offer.handoffSlot.startsAt), endsAt: new Date(offer.handoffSlot.endsAt) } };

/** Rebuilds the state from a stored log, so Postgres keeps only the log and the status. */
export function stateFromLog(log: OffersLog, status: NegotiationStatus): NegotiationState {
  let state = NEW_NEGOTIATION;
  for (const entry of log) {
    const terms = toTerms(entry);
    const event: NegotiationEvent | null =
      entry.from === "buyer"
        ? entry.action === "offer" && terms !== null
          ? { kind: "buyer_offer", terms }
          : entry.action === "accept"
            ? { kind: "buyer_accept" }
            : entry.action === "decline"
              ? { kind: "buyer_decline" }
              : null
        : entry.action === "accept"
          ? { kind: "seller_accept" }
          : entry.action === "counter" && terms !== null
            ? { kind: "seller_counter", terms }
            : entry.action === "decline"
              ? { kind: "seller_decline" }
              : null;
    if (event === null) continue;
    const next = advance(state, event);
    if (next.ok) state = next.state;
  }
  return status === "canceled" ? { ...state, status, offer: null, counter: null } : state;
}

export const listTotalCents = (listings: readonly NegotiableListing[]) => sumCents(listings.map((listing) => listing.priceCents));
export const floorTotalCents = (listings: readonly NegotiableListing[]) => sumCents(listings.map((listing) => listing.floorPriceCents));

/** The time a slot must fall in: every listing's window, and the buyer's own when the plan has one. */
export function negotiationWindow(listings: readonly NegotiableListing[], buyerWindow?: TimeWindow | null): TimeWindow | null {
  const windows = listings.map((listing) => listing.window);
  if (windows.some((window) => window === null)) return null;
  return overlapOf([...(windows as TimeWindow[]), ...(buyerWindow ? [buyerWindow] : [])]);
}

const whole = (cents: number) => cents % 100 === 0;

/** Problems with a buyer offer, each a sentence the agent can act on. An empty list means the offer may go out. */
export function offerProblems(input: { listings: readonly NegotiableListing[]; terms: Terms; state: NegotiationState; buyerWindow?: TimeWindow | null }): string[] {
  const { listings, terms, state } = input;
  if (listings.length === 0) return ["Name at least one listing."];
  const problems: string[] = [];
  if (new Set(listings.map((listing) => listing.id)).size !== listings.length) problems.push("Name each listing once.");
  if (new Set(listings.map((listing) => listing.sellerId)).size > 1) problems.push("A bundle holds listings from one seller only.");
  if (listings.length > BUNDLE_MAX_ITEMS) problems.push(`A bundle holds at most ${BUNDLE_MAX_ITEMS} listings.`);
  if (state.status === "agreed") problems.push("These terms are already agreed.");
  else if (state.status === "round_limit_reached" || state.round >= NEGOTIATION_ROUND_LIMIT) problems.push(`All ${NEGOTIATION_ROUND_LIMIT} rounds are used, so the asking price stands.`);
  const asking = listTotalCents(listings);
  if (terms.priceCents <= 0 || !whole(terms.priceCents)) problems.push("Offer a whole dollar amount.");
  if (terms.priceCents > asking) problems.push(`Offer at most the asking price of $${asking / 100}.`);
  const window = negotiationWindow(listings, input.buyerWindow);
  if (window === null) problems.push("The seller and the student are never on campus at the same time for this item.");
  else if (!isSlotShape(terms.slot)) problems.push("A slot is two hours starting at 10, 12, 14, 16, or 18 campus time.");
  else if (!slotInside(terms.slot, window)) problems.push("That slot falls outside the handoff window.");
  return problems;
}

export interface SellerReply {
  action: "accept" | "counter" | "decline";
  priceCents?: number;
  slot?: TimeWindow;
}

export interface CheckedReply {
  action: "accept" | "counter" | "decline";
  terms: Terms | null;
  /** Why code changed the seller agent's answer, when it did. */
  heldByCode: string | null;
}

/**
 * Turns the seller agent's answer into terms code stands behind. An accept
 * below the floor becomes a counter at the floor, a counter is held between
 * the floor and the asking price in whole dollars, a counter at or under
 * the offer is an accept, and a slot outside the window falls back to the
 * buyer's slot.
 */
export function checkSellerReply(reply: SellerReply, input: { listings: readonly NegotiableListing[]; offer: Terms; window: TimeWindow }): CheckedReply {
  const { listings, offer, window } = input;
  const floor = floorTotalCents(listings);
  const asking = listTotalCents(listings);
  const atFloor = (reason: string): CheckedReply => ({ action: "counter", terms: { priceCents: floor, slot: offer.slot }, heldByCode: reason });
  if (reply.action === "decline") return { action: "decline", terms: null, heldByCode: null };
  if (reply.action === "accept") {
    return offer.priceCents >= floor ? { action: "accept", terms: offer, heldByCode: null } : atFloor("The offer was under the seller's floor, so code countered at the floor.");
  }
  const slot = reply.slot !== undefined && isSlotShape(reply.slot) && slotInside(reply.slot, window) ? reply.slot : offer.slot;
  const slotNote = reply.slot !== undefined && slot === offer.slot && reply.slot.startsAt.getTime() !== offer.slot.startsAt.getTime() ? "The counter's slot fell outside the handoff window, so code kept the buyer's slot." : null;
  const asked = reply.priceCents ?? asking;
  const rounded = Math.round(asked / 100) * 100;
  const price = Math.min(asking, Math.max(floor, rounded));
  const priceNote = price !== asked ? "Code held the counter between the seller's floor and the asking price, in whole dollars." : null;
  if (price <= offer.priceCents) {
    return offer.priceCents >= floor ? { action: "accept", terms: { priceCents: offer.priceCents, slot }, heldByCode: "A counter at or under the offer is an accept." } : atFloor("The offer was under the seller's floor, so code countered at the floor.");
  }
  return { action: "counter", terms: { priceCents: price, slot }, heldByCode: priceNote ?? slotNote };
}

/**
 * Splits an agreed bundle price over its listings. Each listing gets its
 * floor plus a share of what the bundle pays above the floors, weighted by
 * how far each asking price sits above its floor, so no listing lands under
 * its floor or over its asking price. Prices and floors are whole dollars,
 * so shares are split in whole dollars too.
 */
export function allocateBundle(totalCents: number, listings: readonly NegotiableListing[]): Map<string, number> {
  const floor = floorTotalCents(listings);
  const asking = listTotalCents(listings);
  if (totalCents < floor || totalCents > asking) throw new RangeError("A bundle price must sit between the floors and the asking prices.");
  const room = listings.map((listing) => listing.priceCents - listing.floorPriceCents);
  const weights = room.some((value) => value > 0) ? room : listings.map((listing) => listing.priceCents);
  const excess = totalCents - floor;
  const unit = excess % 100 === 0 && listings.every((listing) => listing.floorPriceCents % 100 === 0) ? 100 : 1;
  const shares = allocateByWeight(excess / unit, weights);
  return new Map(listings.map((listing, index) => [listing.id, listing.floorPriceCents + shares[index] * unit]));
}
