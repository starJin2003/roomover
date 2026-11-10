import { createHash } from "node:crypto";
import { z } from "zod";
import type { OfferFacts } from "@/lib/agents/seller/negotiate-prompt";
import { furnitureTypeFor, nounFor } from "@/lib/domain/furniture";
import type { TimeWindow } from "@/lib/domain/handoff";
import { campusClock, formatSlot, isSlotShape, overlapOf, SLOT_START_HOURS, slotFromWindow, slotInside, slotsInside, spreadSlot, windowDays, windowSlotOf, type HeldSlot, type WindowSlot } from "@/lib/domain/handoff-slots";
import {
  advance,
  allocateBundle,
  BUNDLE_MAX_ITEMS,
  checkSellerReply,
  listTotalCents,
  NEGOTIATION_ROUND_LIMIT,
  negotiationWindow,
  NEW_NEGOTIATION,
  offerProblems,
  type CheckedReply,
  type NegotiableListing,
  type NegotiationState,
  type Offer,
  type Terms,
} from "@/lib/domain/negotiation";
import { itemNoun } from "@/lib/domain/room-words";
import { formatUsdShort } from "@/lib/format";
import { firstName, type BuyerContext, type CatalogListing, type EventDraft, type LiveNegotiation, type NegotiationRecord } from "./context";

/**
 * make_offer and respond_to_offer. The buyer agent proposes a price and a
 * slot, a seller agent answers for the seller who has left campus, and code
 * holds every term: the floor, the asking price, the windows, and the round
 * limit. Offers to different sellers run at the same time, and offers to
 * one seller take turns.
 */

const usd = formatUsdShort;
const FAR_FUTURE = new Date("2100-01-01T00:00:00Z");
/** The seller agent sees a few slots near the student's, so its prompt stays short. */
const SLOT_CHOICES = 5;

export const slotInput = z
  .strictObject({
    windowDay: z.number().int().min(1).max(60).describe("Day of the handoff window, counting from 1, as search_listings lists the days."),
    startHour: z.literal(SLOT_START_HOURS).describe("The campus hour the two hour slot starts."),
  })
  .describe("When the student collects the item.");

export const makeOfferInput = z.strictObject({
  listingIds: z
    .array(z.uuid())
    .min(1)
    .max(BUNDLE_MAX_ITEMS)
    .describe("One listingId, or up to four from the same seller to offer one price for them as a bundle."),
  priceDollars: z.number().int().positive().describe("Whole dollars for the listing, or for the whole bundle."),
  slot: slotInput,
});

export const respondToOfferInput = z.strictObject({
  listingIds: z.array(z.uuid()).min(1).max(BUNDLE_MAX_ITEMS).describe("The listingIds of the offer the seller agent countered."),
  action: z.enum(["accept", "decline"]).describe("accept takes the seller agent's counter as it stands, decline leaves the asking price."),
});

export interface NegotiationOutcome {
  result: unknown;
  events: EventDraft[];
}

const nounOf = (listing: CatalogListing) => {
  const furnitureType = furnitureTypeFor(listing);
  return itemNoun({ furnitureType, pieces: listing.specs.pieces ?? 1, ...nounFor(furnitureType, listing.title) });
};

/** "desk", "desk and chair", or "desk, chair, and lamp". */
function nounList(listings: readonly CatalogListing[]): string {
  const nouns = listings.map(nounOf);
  if (nouns.length <= 2) return nouns.join(" and ");
  return `${nouns.slice(0, -1).join(", ")}, and ${nouns.at(-1)}`;
}

export function negotiable(listing: CatalogListing): NegotiableListing {
  return {
    id: listing.id,
    title: listing.title,
    sellerId: listing.sellerId,
    sellerName: listing.sellerName,
    priceCents: listing.priceCents,
    floorPriceCents: listing.floorPriceCents,
    window: listing.pickup,
  };
}

/** The time a slot may use: every listing's window, the student's own, and nothing in the past. */
export function slotWindow(context: Pick<BuyerContext, "buyerWindow" | "now">, listings: readonly CatalogListing[]): TimeWindow | null {
  const shared = negotiationWindow(listings.map(negotiable), context.buyerWindow);
  return shared === null ? null : overlapOf([shared, { startsAt: context.now, endsAt: FAR_FUTURE }]);
}

/** A window as search results describe it to the buyer agent, in window days so a recording stays valid on any day. */
export function handoffForAgent(window: TimeWindow | null) {
  if (window === null) return null;
  const days = windowDays(window);
  const hour = (instant: Date) => hourWords(campusClock(instant).hour);
  return {
    days: days.map((day) => ({ windowDay: day.windowDay, date: day.date })),
    opens: `${hour(window.startsAt)} on day 1`,
    closes: `${hour(window.endsAt)} on day ${days.length}`,
    slotStartHours: [...SLOT_START_HOURS],
  };
}

function hourWords(hour: number): string {
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;
}

/** The negotiation these listings belong to, a new one, or why they cannot be negotiated together. */
function negotiationFor(context: BuyerContext, ids: readonly string[]): LiveNegotiation | string {
  const existing = [...new Set(ids.map((id) => context.negotiations.get(id)).filter((entry): entry is LiveNegotiation => entry !== undefined && entry.state.status !== "canceled"))];
  if (existing.length === 0) return { listingIds: [...ids], state: NEW_NEGOTIATION, log: [], shares: null };
  const [only] = existing;
  const same = existing.length === 1 && only.listingIds.length === ids.length && ids.every((id) => only.listingIds.includes(id));
  if (same) return only;
  return "Some of these listings are already in a negotiation of their own. Offer on exactly the same listings again, or on the others alone.";
}

function recordsOf(negotiation: LiveNegotiation): NegotiationRecord[] {
  const agreed = negotiation.state.status === "agreed" ? negotiation.state.agreed : null;
  return negotiation.listingIds.map((listingId) => ({
    listingId,
    status: negotiation.state.status,
    offers: negotiation.log,
    agreedPriceCents: agreed === null ? null : (negotiation.shares?.get(listingId) ?? agreed.priceCents),
    agreedSlot: agreed?.slot ?? null,
  }));
}

const slotJson = (slot: TimeWindow) => ({ startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() });

function entry(round: number, from: Offer["from"], action: Offer["action"], terms: Terms | null, message: string, at: Date, bundle: readonly string[], heldByCode?: string | null): Offer {
  return {
    round,
    from,
    action,
    ...(terms === null ? {} : { priceCents: terms.priceCents, handoffSlot: slotJson(terms.slot) }),
    ...(bundle.length > 1 ? { bundleListingIds: [...bundle] } : {}),
    message,
    ...(heldByCode ? { heldByCode } : {}),
    at: at.toISOString(),
  };
}

/** The offer's key for recordings: the listings, the round, and every term in window days, never in dates. */
export function offerKey(window: TimeWindow, ids: readonly string[], log: readonly Offer[]): string {
  const terms = log.map((offer) => [
    offer.round,
    offer.from,
    offer.action,
    offer.priceCents ?? null,
    offer.handoffSlot === undefined ? null : windowSlotOf(window, { startsAt: new Date(offer.handoffSlot.startsAt), endsAt: new Date(offer.handoffSlot.endsAt) }),
  ]);
  return createHash("sha256")
    .update(JSON.stringify([[...ids].sort(), terms]))
    .digest("hex");
}

function historyLines(log: readonly Offer[]): string[] {
  return log.map((offer) => {
    const who = offer.from === "buyer" ? "The student's agent" : "You";
    const price = offer.priceCents === undefined ? "" : ` ${usd(offer.priceCents)}`;
    const slot = offer.handoffSlot === undefined ? "" : ` for ${formatSlot({ startsAt: new Date(offer.handoffSlot.startsAt), endsAt: new Date(offer.handoffSlot.endsAt) })}`;
    const verb = { offer: "offered", counter: "countered at", accept: "accepted", decline: "declined" }[offer.action];
    return `Round ${offer.round}: ${who} ${verb}${offer.action === "offer" || offer.action === "counter" ? `${price}${slot}` : ""}.`;
  });
}

/** Offers waiting for a seller agent's answer, by seller, so parallel offers to different sellers see each other's slots. */
const slotsInFlight = new WeakMap<BuyerContext, Map<string, TimeWindow>>();

/** The slot each seller holds in this run: agreed terms, a counter waiting for the buyer agent, or an offer still out. */
function heldSlots(context: BuyerContext): HeldSlot[] {
  const held: HeldSlot[] = [];
  for (const negotiation of new Set(context.negotiations.values())) {
    const sellerId = context.catalog.get(negotiation.listingIds[0])?.sellerId;
    const terms = negotiation.state.status === "agreed" ? negotiation.state.agreed : negotiation.state.status === "canceled" ? null : (negotiation.state.counter ?? negotiation.state.offer);
    if (sellerId !== undefined && terms !== null) held.push({ sellerId, slot: terms.slot });
  }
  for (const [sellerId, slot] of slotsInFlight.get(context) ?? []) held.push({ sellerId, slot });
  return held;
}

const SPREAD_NOTES = {
  together: "Code kept this seller's items in the slot they already hold.",
  spread: "Another seller holds that slot, so code moved the handoff to the nearest free one.",
} as const;

/** Slots near the student's that no other seller holds, earliest first, for a seller agent that wants another time. */
function slotChoices(window: TimeWindow, around: TimeWindow, taken: readonly TimeWindow[]): TimeWindow[] {
  return slotsInside(window)
    .filter((slot) => slot.startsAt.getTime() !== around.startsAt.getTime() && !taken.some((other) => other.startsAt.getTime() === slot.startsAt.getTime()))
    .sort((a, b) => Math.abs(a.startsAt.getTime() - around.startsAt.getTime()) - Math.abs(b.startsAt.getTime() - around.startsAt.getTime()))
    .slice(0, SLOT_CHOICES)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** Offers to one seller take turns, so a second offer reads the first one's answer. */
const sellerTurns = new WeakMap<BuyerContext, Map<string, Promise<unknown>>>();

function inTurn<T>(context: BuyerContext, sellerId: string, work: () => Promise<T>): Promise<T> {
  const turns = sellerTurns.get(context) ?? new Map<string, Promise<unknown>>();
  sellerTurns.set(context, turns);
  const next = (turns.get(sellerId) ?? Promise.resolve()).then(work, work);
  turns.set(
    sellerId,
    next.catch(() => undefined),
  );
  return next;
}

function agentView(window: TimeWindow, terms: Terms) {
  const slot: WindowSlot = windowSlotOf(window, terms.slot);
  return { priceDollars: terms.priceCents / 100, slot: { ...slot, label: formatSlot(terms.slot) } };
}

function refusal(problems: string[], ids: readonly string[]): NegotiationOutcome {
  return {
    result: { sent: false, problems },
    events: [{ tool: "make_offer", blocked: true, summary: `Did not send the offer. ${problems.join(" ")}`, detail: { listingIds: [...ids], problems: problems.slice(0, 12) } }],
  };
}

function sentenceFor(checked: CheckedReply, seller: string, listings: readonly CatalogListing[], failed: boolean): string {
  const terms = checked.terms;
  const items = listings.length > 1 ? ` for the ${nounList(listings)}` : "";
  if (failed) return `${seller}'s agent did not answer this time, so the asking price stands.`;
  if (checked.action === "accept" && terms !== null) return `${seller}'s agent agreed to ${usd(terms.priceCents)}${items} with handoff ${formatSlot(terms.slot)}.`;
  if (checked.action === "counter" && terms !== null) return `${seller}'s agent countered at ${usd(terms.priceCents)}${items}.`;
  return `${seller}'s agent kept the ${nounList(listings)} at ${usd(listTotalCents(listings.map(negotiable)))}.`;
}

export async function makeOffer(context: BuyerContext, input: z.infer<typeof makeOfferInput>): Promise<NegotiationOutcome> {
  const ids = [...new Set(input.listingIds)];
  const listings = ids.map((id) => context.catalog.get(id));
  const missing = ids.filter((_, index) => listings[index] === undefined);
  if (missing.length > 0) return refusal([`No active listing ${missing.join(", ")}. Use listingIds from search_listings.`], ids);
  const found = listings as CatalogListing[];
  if (context.negotiator === undefined) return refusal(["Negotiation is not available in this run, so the asking prices stand."], ids);
  return inTurn(context, found[0].sellerId, () => negotiate(context, ids, found, input));
}

async function negotiate(context: BuyerContext, ids: string[], listings: CatalogListing[], input: z.infer<typeof makeOfferInput>): Promise<NegotiationOutcome> {
  const port = context.negotiator as NonNullable<BuyerContext["negotiator"]>;
  const negotiation = negotiationFor(context, ids);
  if (typeof negotiation === "string") return refusal([negotiation], ids);
  const window = slotWindow(context, listings);
  const sellerId = listings[0].sellerId;
  const requested = window === null ? null : slotFromWindow(window, input.slot);
  // Only a well formed slot inside the window moves. Anything else goes on to the checks that refuse it.
  const spread = window !== null && requested !== null && isSlotShape(requested) && slotInside(requested, window) ? spreadSlot(requested, window, sellerId, heldSlots(context)) : null;
  const slot = spread?.slot ?? requested;
  const terms: Terms = { priceCents: input.priceDollars * 100, slot: slot ?? { startsAt: new Date(0), endsAt: new Date(0) } };
  const problems = offerProblems({ listings: listings.map(negotiable), terms, state: negotiation.state, buyerWindow: window });
  if (slot === null && window !== null && problems.length === 0) problems.push("That day falls outside the handoff window.");
  if (problems.length > 0 || window === null) return refusal(problems.length > 0 ? problems : ["The seller and the student are never on campus at the same time for this item."], ids);

  const opened = advance(negotiation.state, { kind: "buyer_offer", terms });
  if (!opened.ok) return refusal([opened.problem], ids);
  const inFlight = slotsInFlight.get(context) ?? new Map<string, TimeWindow>();
  slotsInFlight.set(context, inFlight);
  inFlight.set(sellerId, terms.slot);
  try {
    return await answered(context, port, { ids, listings, negotiation, window, terms, opened: opened.state, moved: spread?.moved ?? null });
  } finally {
    inFlight.delete(sellerId);
  }
}

interface OpenedOffer {
  ids: string[];
  listings: CatalogListing[];
  negotiation: LiveNegotiation;
  window: TimeWindow;
  terms: Terms;
  opened: NegotiationState;
  /** Why code moved the slot the buyer agent asked for, if it did. */
  moved: "together" | "spread" | null;
}

async function answered(context: BuyerContext, port: NonNullable<BuyerContext["negotiator"]>, offer: OpenedOffer): Promise<NegotiationOutcome> {
  const { ids, listings, negotiation, window, terms, moved } = offer;
  const seller = firstName(listings[0].sellerName);
  const round = offer.opened.round;
  const log = [...negotiation.log, entry(round, "buyer", "offer", terms, `Offer of ${usd(terms.priceCents)}.`, new Date(), ids)];
  const offerEvent: EventDraft = {
    tool: "make_offer",
    summary: `Offered ${seller} ${usd(terms.priceCents)} for the ${nounList(listings)} with handoff ${formatSlot(terms.slot)}, round ${round} of ${NEGOTIATION_ROUND_LIMIT}.${moved === null ? "" : ` ${SPREAD_NOTES[moved]}`}`,
    detail: { listingIds: ids, priceCents: terms.priceCents, negotiation: { round, from: "buyer", action: "offer", priceCents: terms.priceCents, slot: formatSlot(terms.slot) } },
  };

  const asking = listTotalCents(listings.map(negotiable));
  let checked: CheckedReply;
  let message: string;
  let failed = false;
  let usage: { claudeCalls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; latencyMs: number } | null = null;
  if (terms.priceCents >= asking) {
    checked = { action: "accept", terms, heldByCode: "The offer met the asking price, so code accepted it." };
    message = "Accepted at the asking price.";
  } else {
    const taken = heldSlots(context).filter((entry) => entry.sellerId !== listings[0].sellerId).map((entry) => entry.slot);
    const choices = slotChoices(window, terms.slot, taken);
    const facts: OfferFacts = {
      sellerFirstName: seller,
      items: listings.map((listing) => ({ title: listing.title, askingCents: listing.priceCents, floorCents: listing.floorPriceCents })),
      round,
      roundLimit: NEGOTIATION_ROUND_LIMIT,
      history: historyLines(negotiation.log),
      offer: { priceCents: terms.priceCents, slotLabel: formatSlot(terms.slot) },
      slots: choices.map((choice, index) => ({ number: index + 1, label: formatSlot(choice) })),
    };
    const answer = await port.answer(offerKey(window, ids, log), facts);
    usage = { claudeCalls: answer.usage.calls, inputTokens: answer.usage.inputTokens, outputTokens: answer.usage.outputTokens, cacheReadTokens: answer.usage.cacheReadTokens, latencyMs: answer.latencyMs };
    if (answer.ok) {
      const picked = answer.answer.slotNumber === null ? undefined : choices[answer.answer.slotNumber - 1];
      checked = checkSellerReply(
        { action: answer.answer.action, ...(answer.answer.counterDollars === null ? {} : { priceCents: answer.answer.counterDollars * 100 }), ...(picked === undefined ? {} : { slot: picked }) },
        { listings: listings.map(negotiable), offer: terms, window },
      );
      message = answer.answer.message;
    } else {
      failed = true;
      checked = { action: "decline", terms: null, heldByCode: "The seller agent gave no valid answer, so code declined for it." };
      message = "No answer.";
    }
  }

  const event = checked.action === "accept" ? ({ kind: "seller_accept" } as const) : checked.action === "counter" && checked.terms !== null ? ({ kind: "seller_counter", terms: checked.terms } as const) : ({ kind: "seller_decline" } as const);
  const next = advance(offer.opened, event);
  const state = next.ok ? next.state : offer.opened;
  const sellerEntry = entry(round, "seller", checked.action, checked.terms, message, new Date(), ids, checked.heldByCode);
  const shares = state.status === "agreed" && state.agreed !== null && ids.length > 1 ? allocateBundle(state.agreed.priceCents, listings.map(negotiable)) : null;
  const updated: LiveNegotiation = { listingIds: ids, state, log: [...log, sellerEntry], shares };
  for (const id of ids) context.negotiations.set(id, updated);
  await port.save(recordsOf(updated));

  const answerEvent: EventDraft = {
    tool: "make_offer",
    agent: "seller",
    summary: `${seller}'s agent ${failed ? "gave no valid answer" : { accept: "accepted", counter: "countered", decline: "declined" }[checked.action]}${checked.terms === null ? "" : ` at ${usd(checked.terms.priceCents)} with handoff ${formatSlot(checked.terms.slot)}`}. "${message}"${checked.heldByCode ? ` ${checked.heldByCode}` : ""}`,
    sentence: sentenceFor(checked, seller, listings, failed),
    detail: {
      listingIds: ids,
      ...(checked.terms === null ? {} : { priceCents: checked.terms.priceCents }),
      negotiation: {
        round,
        from: "seller",
        action: checked.action,
        ...(checked.terms === null ? {} : { priceCents: checked.terms.priceCents, slot: formatSlot(checked.terms.slot) }),
        message,
        ...(checked.heldByCode ? { heldByCode: checked.heldByCode } : {}),
      },
      ...(usage === null ? {} : usage),
    },
  };

  return {
    result: {
      sent: true,
      seller,
      round,
      roundsLeft: NEGOTIATION_ROUND_LIMIT - round,
      answer: failed ? "no_answer" : checked.action,
      ...(checked.terms === null ? {} : agentView(window, checked.terms)),
      sellerMessage: message,
      status: state.status,
      ...(state.status === "agreed" ? { agreed: true } : {}),
      ...(checked.action === "counter" ? { next: "Accept or decline the counter with respond_to_offer, or make a new offer while rounds remain." } : {}),
      ...(checked.heldByCode && !failed ? { note: checked.heldByCode } : {}),
      ...(moved === null ? {} : { slotNote: SPREAD_NOTES[moved] }),
    },
    events: [{ ...offerEvent }, answerEvent],
  };
}

export async function respondToOffer(context: BuyerContext, input: z.infer<typeof respondToOfferInput>): Promise<NegotiationOutcome> {
  const ids = [...new Set(input.listingIds)];
  const negotiation = context.negotiations.get(ids[0]);
  const refuse = (problem: string): NegotiationOutcome => ({ result: { done: false, problems: [problem] }, events: [] });
  if (negotiation === undefined || negotiation.listingIds.length !== ids.length || !ids.every((id) => negotiation.listingIds.includes(id))) {
    return refuse("There is no counter for exactly these listings. Use the listingIds from the make_offer that was countered.");
  }
  const counter = negotiation.state.counter;
  const next = advance(negotiation.state, input.action === "accept" ? { kind: "buyer_accept" } : { kind: "buyer_decline" });
  if (!next.ok || counter === null) return refuse(next.ok ? "There is no counter to answer." : next.problem);
  const listings = ids.map((id) => context.catalog.get(id)).filter((listing): listing is CatalogListing => listing !== undefined);
  if (listings.length !== ids.length || context.negotiator === undefined) return refuse("These listings are no longer available to negotiate.");
  const seller = firstName(listings[0].sellerName);
  const accepted = input.action === "accept";
  const shares = accepted && ids.length > 1 ? allocateBundle(counter.priceCents, listings.map(negotiable)) : null;
  const updated: LiveNegotiation = {
    listingIds: ids,
    state: next.state,
    log: [...negotiation.log, entry(negotiation.state.round, "buyer", accepted ? "accept" : "decline", accepted ? counter : null, accepted ? `Accepted ${usd(counter.priceCents)}.` : "Declined the counter.", new Date(), ids)],
    shares,
  };
  for (const id of ids) context.negotiations.set(id, updated);
  await context.negotiator.save(recordsOf(updated));
  const window = slotWindow(context, listings);
  const items = listings.length > 1 ? ` for the ${nounList(listings)}` : "";
  return {
    result: { done: true, status: next.state.status, ...(accepted && window !== null ? agentView(window, counter) : {}), ...(accepted ? {} : { note: "The asking price stands for these listings." }) },
    events: [
      {
        tool: "respond_to_offer",
        summary: accepted ? `Accepted ${seller}'s counter of ${usd(counter.priceCents)}${items} with handoff ${formatSlot(counter.slot)}.` : `Declined ${seller}'s counter of ${usd(counter.priceCents)}${items}. The asking price stands.`,
        sentence: accepted ? `Took ${seller}'s counter of ${usd(counter.priceCents)}${items} with handoff ${formatSlot(counter.slot)}.` : undefined,
        detail: {
          listingIds: ids,
          priceCents: counter.priceCents,
          negotiation: { round: negotiation.state.round, from: "buyer", action: accepted ? "accept" : "decline", priceCents: counter.priceCents, slot: formatSlot(counter.slot) },
        },
      },
    ],
  };
}

/** Cancels the negotiation of a listing that left the plan. A bundle ends for all its listings, which go back to their asking prices. */
export async function cancelNegotiation(context: BuyerContext, listingId: string): Promise<EventDraft[]> {
  const negotiation = context.negotiations.get(listingId);
  if (negotiation === undefined || negotiation.state.status === "canceled" || context.negotiator === undefined) return [];
  const next = advance(negotiation.state, { kind: "cancel" });
  if (!next.ok) return [];
  const updated: LiveNegotiation = { ...negotiation, state: next.state, shares: null };
  for (const id of negotiation.listingIds) context.negotiations.set(id, updated);
  await context.negotiator.save(recordsOf(updated));
  return [{ tool: "remove_item", summary: `Canceled the negotiation for ${negotiation.listingIds.length === 1 ? "this listing" : `${negotiation.listingIds.length} bundled listings`}, so their asking prices stand.`, detail: { listingIds: negotiation.listingIds } }];
}
