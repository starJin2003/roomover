import { describe, expect, it } from "vitest";
import { campusInstant, formatSlot, isSlotShape, overlapOf, slotFor, slotFromWindow, slotsInside, spreadSlot, windowDays, windowSlotOf } from "@/lib/domain/handoff-slots";
import {
  advance,
  allocateBundle,
  checkSellerReply,
  NEGOTIATION_ROUND_LIMIT,
  negotiationWindow,
  NEW_NEGOTIATION,
  offerProblems,
  stateFromLog,
  type NegotiableListing,
  type NegotiationState,
  type Offer,
  type Terms,
} from "@/lib/domain/negotiation";

// Jun's winter window on a 2026-11-09 seed day: move out days 7 to 16 overlapping winter move in days 14 to 16.
const WINDOW = { startsAt: campusInstant("2026-11-23", 9), endsAt: campusInstant("2026-11-25", 18) };
const DESK: NegotiableListing = { id: "11111111-1111-4111-8111-111111111111", title: "White three drawer desk with oak legs", sellerId: "jun", sellerName: "Jun Park", priceCents: 5_500, floorPriceCents: 4_000, window: WINDOW };
const CHAIR: NegotiableListing = { id: "22222222-2222-4222-8222-222222222222", title: "Black wood chair with red velvet seat", sellerId: "jun", sellerName: "Jun Park", priceCents: 2_000, floorPriceCents: 1_400, window: WINDOW };
const LAMP: NegotiableListing = { id: "33333333-3333-4333-8333-333333333333", title: "Black balance arm desk lamp", sellerId: "ava", sellerName: "Ava Lindqvist", priceCents: 1_600, floorPriceCents: 1_200, window: WINDOW };

const slot = (day: string, hour: number) => slotFor({ day, startHour: hour });
const terms = (priceCents: number, at = slot("2026-11-23", 14)): Terms => ({ priceCents, slot: at });

describe("handoff slots", () => {
  it("builds two hour slots in campus time and names them", () => {
    const monday = slot("2026-11-23", 14);
    expect(monday.startsAt.toISOString()).toBe("2026-11-23T20:00:00.000Z");
    expect(formatSlot(monday)).toBe("Mon, Nov 23, 2 to 4 PM");
    expect(formatSlot(slot("2026-11-23", 10))).toBe("Mon, Nov 23, 10 AM to noon");
    expect(isSlotShape(monday)).toBe(true);
    expect(isSlotShape({ startsAt: monday.startsAt, endsAt: new Date(monday.endsAt.getTime() + 60_000) })).toBe(false);
    expect(isSlotShape(slot("2026-11-23", 11))).toBe(false);
  });

  it("keeps campus hours across the end of daylight saving time", () => {
    expect(slot("2026-10-30", 10).startsAt.toISOString()).toBe("2026-10-30T15:00:00.000Z");
    expect(slot("2026-11-02", 10).startsAt.toISOString()).toBe("2026-11-02T16:00:00.000Z");
  });

  it("lists every slot inside a window and numbers its days for the agents", () => {
    const slots = slotsInside(WINDOW);
    expect(slots).toHaveLength(14);
    expect(formatSlot(slots[0])).toBe("Mon, Nov 23, 10 AM to noon");
    expect(formatSlot(slots.at(-1) as (typeof slots)[number])).toBe("Wed, Nov 25, 4 to 6 PM");
    expect(windowDays(WINDOW).map((day) => day.date)).toEqual(["Mon, Nov 23", "Tue, Nov 24", "Wed, Nov 25"]);
  });

  it("turns a window day into a slot and back, so recordings stay valid when the windows move", () => {
    const chosen = slotFromWindow(WINDOW, { windowDay: 2, startHour: 16 });
    expect(chosen).not.toBeNull();
    expect(formatSlot(chosen as NonNullable<typeof chosen>)).toBe("Tue, Nov 24, 4 to 6 PM");
    expect(windowSlotOf(WINDOW, chosen as NonNullable<typeof chosen>)).toEqual({ windowDay: 2, startHour: 16 });
    const moved = { startsAt: campusInstant("2026-11-30", 9), endsAt: campusInstant("2026-12-02", 18) };
    expect(formatSlot(slotFromWindow(moved, { windowDay: 2, startHour: 16 }) as NonNullable<typeof chosen>)).toBe("Tue, Dec 1, 4 to 6 PM");
    expect(slotFromWindow(WINDOW, { windowDay: 9, startHour: 10 })).toBeNull();
  });

  it("finds the time every window shares", () => {
    expect(overlapOf([WINDOW, { startsAt: campusInstant("2026-11-24", 0), endsAt: campusInstant("2026-12-01", 0) }])?.startsAt).toEqual(campusInstant("2026-11-24", 0));
    expect(overlapOf([WINDOW, { startsAt: campusInstant("2026-12-01", 0), endsAt: campusInstant("2026-12-02", 0) }])).toBeNull();
  });
});

describe("offer validation", () => {
  it("accepts a whole dollar offer under the asking price on a slot inside the window", () => {
    expect(offerProblems({ listings: [DESK], terms: terms(4_500), state: NEW_NEGOTIATION })).toEqual([]);
  });

  it("refuses an offer above the asking price, in cents, or outside the window", () => {
    expect(offerProblems({ listings: [DESK], terms: terms(6_000), state: NEW_NEGOTIATION })).toEqual(["Offer at most the asking price of $55."]);
    expect(offerProblems({ listings: [DESK], terms: terms(4_550), state: NEW_NEGOTIATION })).toEqual(["Offer a whole dollar amount."]);
    expect(offerProblems({ listings: [DESK], terms: terms(4_500, slot("2026-11-26", 14)), state: NEW_NEGOTIATION })).toEqual(["That slot falls outside the handoff window."]);
    expect(offerProblems({ listings: [DESK], terms: terms(4_500, slot("2026-11-25", 18)), state: NEW_NEGOTIATION })).toEqual(["That slot falls outside the handoff window."]);
  });

  it("needs both students on campus at once", () => {
    const later = { ...LAMP, window: { startsAt: campusInstant("2027-04-18", 9), endsAt: campusInstant("2027-04-21", 18) } };
    expect(negotiationWindow([DESK, later])).toBeNull();
    expect(negotiationWindow([DESK], { startsAt: campusInstant("2026-11-24", 0), endsAt: campusInstant("2026-11-30", 0) })?.startsAt).toEqual(campusInstant("2026-11-24", 0));
    expect(offerProblems({ listings: [{ ...DESK, window: null }], terms: terms(4_500), state: NEW_NEGOTIATION })).toEqual(["The seller and the student are never on campus at the same time for this item."]);
  });

  it("holds a bundle to one seller and the round limit to three", () => {
    expect(offerProblems({ listings: [DESK, LAMP], terms: terms(6_000), state: NEW_NEGOTIATION })).toContain("A bundle holds listings from one seller only.");
    const spent: NegotiationState = { ...NEW_NEGOTIATION, round: NEGOTIATION_ROUND_LIMIT };
    expect(offerProblems({ listings: [DESK], terms: terms(4_500), state: spent })).toEqual(["All 3 rounds are used, so the asking price stands."]);
    expect(offerProblems({ listings: [DESK], terms: terms(4_500), state: { ...NEW_NEGOTIATION, status: "agreed" } })).toEqual(["These terms are already agreed."]);
  });
});

describe("seller answers checked in code", () => {
  const offer = terms(3_500);
  const input = { listings: [DESK], offer, window: WINDOW };

  it("never accepts below the floor", () => {
    expect(checkSellerReply({ action: "accept" }, input)).toEqual({ action: "counter", terms: { priceCents: 4_000, slot: offer.slot }, heldByCode: "The offer was under the seller's floor, so code countered at the floor." });
    expect(checkSellerReply({ action: "accept" }, { ...input, offer: terms(4_500) })).toEqual({ action: "accept", terms: terms(4_500), heldByCode: null });
  });

  it("holds a counter between the floor and the asking price in whole dollars", () => {
    expect(checkSellerReply({ action: "counter", priceCents: 3_000 }, input).terms?.priceCents).toBe(4_000);
    expect(checkSellerReply({ action: "counter", priceCents: 9_000 }, input).terms?.priceCents).toBe(5_500);
    expect(checkSellerReply({ action: "counter", priceCents: 4_849 }, input)).toEqual({ action: "counter", terms: { priceCents: 4_800, slot: offer.slot }, heldByCode: "Code held the counter between the seller's floor and the asking price, in whole dollars." });
  });

  it("treats a counter at or under the offer as an accept", () => {
    expect(checkSellerReply({ action: "counter", priceCents: 4_500 }, { ...input, offer: terms(4_600) })).toMatchObject({ action: "accept", terms: { priceCents: 4_600 } });
  });

  it("keeps the buyer's slot when the counter's slot falls outside the window", () => {
    const outside = slot("2026-11-27", 10);
    const checked = checkSellerReply({ action: "counter", priceCents: 5_000, slot: outside }, input);
    expect(checked.terms?.slot).toEqual(offer.slot);
    expect(checked.heldByCode).toBe("The counter's slot fell outside the handoff window, so code kept the buyer's slot.");
    const inside = slot("2026-11-24", 12);
    expect(checkSellerReply({ action: "counter", priceCents: 5_000, slot: inside }, input).terms?.slot).toEqual(inside);
  });
});

describe("bundle math", () => {
  it("gives each listing its floor plus a share of what the bundle pays above the floors", () => {
    const shares = allocateBundle(6_500, [DESK, CHAIR]);
    expect([...shares.values()].reduce((sum, value) => sum + value, 0)).toBe(6_500);
    expect(shares.get(DESK.id)).toBe(4_800);
    expect(shares.get(CHAIR.id)).toBe(1_700);
    for (const listing of [DESK, CHAIR]) {
      expect(shares.get(listing.id)).toBeGreaterThanOrEqual(listing.floorPriceCents);
      expect(shares.get(listing.id)).toBeLessThanOrEqual(listing.priceCents);
    }
  });

  it("refuses a bundle price outside the floors and the asking prices", () => {
    expect(() => allocateBundle(5_000, [DESK, CHAIR])).toThrow(RangeError);
    expect(() => allocateBundle(8_000, [DESK, CHAIR])).toThrow(RangeError);
    expect([...allocateBundle(5_400, [DESK, CHAIR]).values()]).toEqual([4_000, 1_400]);
  });
});

describe("negotiation state machine", () => {
  const step = (state: NegotiationState, event: Parameters<typeof advance>[1]) => {
    const next = advance(state, event);
    if (!next.ok) throw new Error(next.problem);
    return next.state;
  };

  it("agrees when the seller accepts, or when the buyer takes a counter", () => {
    const offered = step(NEW_NEGOTIATION, { kind: "buyer_offer", terms: terms(4_500) });
    expect(offered).toMatchObject({ status: "open", round: 1, offer: terms(4_500) });
    expect(step(offered, { kind: "seller_accept" })).toMatchObject({ status: "agreed", agreed: terms(4_500), offer: null });
    const countered = step(offered, { kind: "seller_counter", terms: terms(5_000) });
    expect(step(countered, { kind: "buyer_accept" })).toMatchObject({ status: "agreed", agreed: terms(5_000) });
    expect(step(countered, { kind: "buyer_decline" }).status).toBe("declined");
  });

  it("refuses moves out of turn", () => {
    expect(advance(NEW_NEGOTIATION, { kind: "seller_accept" })).toEqual({ ok: false, problem: "There is no offer to accept." });
    const offered = step(NEW_NEGOTIATION, { kind: "buyer_offer", terms: terms(4_500) });
    expect(advance(offered, { kind: "buyer_offer", terms: terms(4_600) })).toEqual({ ok: false, problem: "The seller agent has not answered the last offer yet." });
    expect(advance(offered, { kind: "buyer_accept" })).toEqual({ ok: false, problem: "There is no counter to accept." });
  });

  it("reaches the round limit after three rounds without agreement", () => {
    let state = NEW_NEGOTIATION;
    for (let round = 1; round <= 3; round++) {
      state = step(state, { kind: "buyer_offer", terms: terms(3_000 + round * 100) });
      state = round < 3 ? step(state, { kind: "seller_counter", terms: terms(5_000) }) : step(state, { kind: "seller_decline" });
    }
    expect(state).toMatchObject({ status: "round_limit_reached", round: 3 });
    expect(advance(state, { kind: "buyer_offer", terms: terms(4_000) })).toEqual({ ok: false, problem: "All 3 rounds are used, so the asking price stands." });
  });

  it("keeps a final counter open for the buyer in round three", () => {
    let state = NEW_NEGOTIATION;
    for (let round = 1; round <= 3; round++) {
      state = step(state, { kind: "buyer_offer", terms: terms(4_000 + round * 100) });
      state = step(state, { kind: "seller_counter", terms: terms(5_000) });
    }
    expect(state).toMatchObject({ status: "open", round: 3, counter: terms(5_000) });
    expect(step(state, { kind: "buyer_decline" }).status).toBe("round_limit_reached");
  });

  it("cancels agreed terms when the item leaves the plan", () => {
    const agreed = step(step(NEW_NEGOTIATION, { kind: "buyer_offer", terms: terms(4_500) }), { kind: "seller_accept" });
    expect(step(agreed, { kind: "cancel" }).status).toBe("canceled");
    expect(advance(agreed, { kind: "buyer_offer", terms: terms(4_000) })).toEqual({ ok: false, problem: "These terms are already agreed." });
  });

  it("rebuilds the same state from the stored log", () => {
    const at = "2026-11-09T18:00:00.000Z";
    const json = (value: Terms) => ({ priceCents: value.priceCents, handoffSlot: { startsAt: value.slot.startsAt.toISOString(), endsAt: value.slot.endsAt.toISOString() } });
    const log: Offer[] = [
      { round: 1, from: "buyer", action: "offer", ...json(terms(4_000)), message: "Offer of $40.", at },
      { round: 1, from: "seller", action: "counter", ...json(terms(4_800)), message: "How about $48?", at },
      { round: 1, from: "buyer", action: "accept", ...json(terms(4_800)), message: "Accepted $48.", at },
    ];
    expect(stateFromLog(log, "agreed")).toMatchObject({ status: "agreed", round: 1, agreed: terms(4_800) });
    expect(stateFromLog(log, "canceled").status).toBe("canceled");
  });
});

describe("spreadSlot", () => {
  const day = { startsAt: campusInstant("2026-11-23", 10), endsAt: campusInstant("2026-11-23", 20) };
  const at = (hour: number) => slotFor({ day: "2026-11-23", startHour: hour });
  const label = (result: ReturnType<typeof spreadSlot>) => formatSlot(result.slot);

  it("keeps the requested slot when no other seller holds it", () => {
    expect(spreadSlot(at(10), day, "jun", [{ sellerId: "ava", slot: at(12) }])).toEqual({ slot: at(10), moved: null });
  });

  it("moves to the nearest free slot, the later one on a tie, when another seller holds the one asked for", () => {
    expect(label(spreadSlot(at(10), day, "lea", [{ sellerId: "ava", slot: at(10) }]))).toBe("Mon, Nov 23, noon to 2 PM");
    const tie = spreadSlot(at(14), day, "lea", [{ sellerId: "ava", slot: at(14) }]);
    expect(tie).toMatchObject({ moved: "spread" });
    expect(label(tie)).toBe("Mon, Nov 23, 4 to 6 PM");
  });

  it("keeps one seller's items together in the slot that seller already holds", () => {
    expect(spreadSlot(at(16), day, "jun", [{ sellerId: "jun", slot: at(12) }])).toEqual({ slot: at(12), moved: "together" });
    expect(spreadSlot(at(12), day, "jun", [{ sellerId: "jun", slot: at(12) }])).toEqual({ slot: at(12), moved: null });
  });

  it("ignores a held slot outside this item's window and leaves the request when every slot is taken", () => {
    const outside = { sellerId: "jun", slot: slotFor({ day: "2026-11-24", startHour: 10 }) };
    expect(spreadSlot(at(10), day, "jun", [outside])).toEqual({ slot: at(10), moved: null });
    const everyone = [10, 12, 14, 16, 18].map((hour, index) => ({ sellerId: `seller-${index}`, slot: at(hour) }));
    expect(spreadSlot(at(10), day, "lea", everyone)).toEqual({ slot: at(10), moved: null });
  });
});
