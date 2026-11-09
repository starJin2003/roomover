import { describe, expect, it } from "vitest";
import { buildCheckout, CheckoutRefused, intentFor, sameLines, type CheckoutListing } from "@/lib/domain/checkout";
import { slotFor } from "@/lib/domain/handoff-slots";

const CHECKOUT_AT = new Date("2026-11-09T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(CHECKOUT_AT.getTime() + days * DAY);

/** A direct handoff whose window ends the given number of days after checkout. */
function listing(id: string, overrides: Partial<CheckoutListing> = {}, endsInDays = 15): CheckoutListing {
  return {
    id,
    title: `Item ${id}`,
    sellerId: `seller-${id}`,
    sellerName: `Seller ${id}`,
    priceCents: 1_000,
    floorPriceCents: 700,
    agreement: null,
    handoffMode: "direct",
    status: "active",
    moveOutStartsAt: at(5),
    moveOutEndsAt: at(endsInDays),
    moveInStartsAt: at(4),
    moveInEndsAt: at(endsInDays + 2),
    ...overrides,
  };
}

const catalog = (...items: CheckoutListing[]) => new Map(items.map((item) => [item.id, item]));

describe("buildCheckout", () => {
  it("takes every amount from the listings, keeps the plan's order, and counts sellers", () => {
    const listings = catalog(
      listing("lamp", { priceCents: 1_600, sellerId: "ava", sellerName: "Ava Lindqvist" }),
      listing("rug", { priceCents: 2_200, sellerId: "jun", sellerName: "Jun Park" }),
      listing("tower", { priceCents: 1_000, sellerId: "ava", sellerName: "Ava Lindqvist" }),
    );
    const checkout = buildCheckout(["rug", "lamp", "tower"], listings, CHECKOUT_AT);
    expect(checkout.lines.map((line) => [line.listingId, line.amountCents, line.sellerName])).toEqual([
      ["rug", 2_200, "Jun Park"],
      ["lamp", 1_600, "Ava Lindqvist"],
      ["tower", 1_000, "Ava Lindqvist"],
    ]);
    expect(checkout.totalCents).toBe(4_800);
    expect(checkout.sellerCount).toBe(2);
    expect(checkout.paymentMode).toBe("authorize_then_capture");
  });

  it("authorizes when the last handoff ends exactly 29 days after checkout and captures one millisecond later", () => {
    const edge = listing("edge", { moveOutEndsAt: at(29), moveInEndsAt: at(29) });
    expect(buildCheckout(["edge"], catalog(edge), CHECKOUT_AT).paymentMode).toBe("authorize_then_capture");
    const later = listing("later", { moveOutEndsAt: new Date(at(29).getTime() + 1), moveInEndsAt: at(31) });
    expect(buildCheckout(["edge", "later"], catalog(edge, later), CHECKOUT_AT).paymentMode).toBe("capture_at_checkout");
    expect(intentFor("authorize_then_capture")).toBe("AUTHORIZE");
    expect(intentFor("capture_at_checkout")).toBe("CAPTURE");
  });

  it("measures a storage hold by the move in window", () => {
    const storage = listing("box", { handoffMode: "storage_hold", moveOutStartsAt: at(1), moveOutEndsAt: at(2), moveInStartsAt: at(160), moveInEndsAt: at(163) });
    expect(buildCheckout(["box"], catalog(storage), CHECKOUT_AT).lines[0].handoff).toEqual({ startsAt: at(160), endsAt: at(163) });
    expect(buildCheckout(["box"], catalog(storage), CHECKOUT_AT).paymentMode).toBe("capture_at_checkout");
  });

  it("refuses an empty plan, a listing someone else reserved, and a handoff that cannot happen", () => {
    expect(() => buildCheckout([], catalog(), CHECKOUT_AT)).toThrow(new CheckoutRefused("empty", "The room has no items to pay for yet."));
    const taken = listing("chair", { status: "reserved", title: "Navy bean bag chair" });
    expect(() => buildCheckout(["chair"], catalog(taken), CHECKOUT_AT)).toThrow("Navy bean bag chair is no longer available. Replace or remove it first.");
    try {
      buildCheckout(["chair", "gone"], catalog(taken), CHECKOUT_AT);
    } catch (error) {
      expect(error).toMatchObject({ reason: "unavailable", listingIds: ["chair", "gone"] });
    }
    const apart = listing("desk", { moveOutStartsAt: at(1), moveOutEndsAt: at(2), moveInStartsAt: at(10), moveInEndsAt: at(12) });
    expect(() => buildCheckout(["desk"], catalog(apart), CHECKOUT_AT)).toThrow("Item desk has no handoff time left before move in.");
  });
});

describe("agreed terms at checkout", () => {
  const slot = slotFor({ day: "2026-11-16", startHour: 14 });

  it("charges the agreed price and keeps the agreed slot", () => {
    const plan = buildCheckout(["desk", "lamp"], catalog(listing("desk", { agreement: { priceCents: 800, slot } }), listing("lamp")), CHECKOUT_AT);
    expect(plan.lines.map((line) => [line.amountCents, line.listPriceCents, line.slot])).toEqual([
      [800, 1_000, slot],
      [1_000, 1_000, null],
    ]);
    expect(plan.totalCents).toBe(1_800);
  });

  it("falls back to the listed price and window when an agreement no longer fits the listing", () => {
    const belowFloor = listing("desk", { agreement: { priceCents: 600, slot } });
    const outside = listing("lamp", { agreement: { priceCents: 800, slot: slotFor({ day: "2026-11-30", startHour: 14 }) } });
    const odd = listing("rug", { agreement: { priceCents: 800, slot: { startsAt: slot.startsAt, endsAt: new Date(slot.endsAt.getTime() + 60_000) } } });
    const plan = buildCheckout(["desk", "lamp", "rug"], catalog(belowFloor, outside, odd), CHECKOUT_AT);
    expect(plan.lines.map((line) => [line.amountCents, line.slot])).toEqual([
      [1_000, null],
      [1_000, null],
      [1_000, null],
    ]);
  });

  it("decides the payment mode from the agreed slot, which can bring a long window inside the authorization", () => {
    const long = listing("desk", { agreement: { priceCents: 900, slot } }, 40);
    expect(buildCheckout(["desk"], catalog(long), CHECKOUT_AT).paymentMode).toBe("authorize_then_capture");
    expect(buildCheckout(["desk"], catalog({ ...long, agreement: null }), CHECKOUT_AT).paymentMode).toBe("capture_at_checkout");
  });
});

describe("sameLines", () => {
  it("matches the same listings at the same prices and slots in any order", () => {
    const a = [{ listingId: "x", amountCents: 100, slot: null }, { listingId: "y", amountCents: 200, slot: null }];
    expect(sameLines(a, [...a].reverse())).toBe(true);
    expect(sameLines(a, [{ listingId: "x", amountCents: 100, slot: null }])).toBe(false);
    expect(sameLines(a, [{ listingId: "x", amountCents: 100, slot: null }, { listingId: "y", amountCents: 250, slot: null }])).toBe(false);
    const slot = slotFor({ day: "2026-11-16", startHour: 14 });
    expect(sameLines(a, [{ listingId: "x", amountCents: 100, slot: null }, { listingId: "y", amountCents: 200, slot }])).toBe(false);
  });
});
