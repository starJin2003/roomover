import { describe, expect, it } from "vitest";
import {
  ACTIVITY_LOG,
  BUDGET_CENTS,
  FURNISH,
  HANDOFF,
  MONEY,
  PAYOUT_ARRIVALS,
  PAYPAL_MOMENTS,
  SELL,
  SELLER_PAYOUTS,
} from "@/app/style-guide/demo-data";
import { AGENT_NAMES } from "@/lib/domain/enums";
import { sumCents } from "@/lib/domain/money";
import { seedListings } from "@/scripts/seed/listings";

describe("style guide demo data", () => {
  it("conserves money from authorization to payouts", () => {
    expect(MONEY).toMatchObject({ authorizedCents: 14_100, capturedCents: 13_600, releasedCents: 500 });
    expect(MONEY.capturedCents + MONEY.releasedCents).toBe(MONEY.authorizedCents);
    expect(sumCents(SELLER_PAYOUTS.map((row) => row.amountCents))).toBe(MONEY.capturedCents);
  });

  it("stays inside the budget and shows the real savings against new", () => {
    expect(MONEY.authorizedCents).toBeLessThanOrEqual(BUDGET_CENTS);
    expect(MONEY.newCents - MONEY.authorizedCents).toBe(40_700);
  });

  it("pays five distinct sellers, and the replay delivers each payout once", () => {
    expect(new Set(SELLER_PAYOUTS.map((row) => row.sellerName)).size).toBe(5);
    expect([...PAYOUT_ARRIVALS].sort()).toEqual(SELLER_PAYOUTS.map((row) => row.payoutItemId).sort());
  });

  it("tells the activity in about three sentences, with every agent in the log behind Details", () => {
    expect(FURNISH.sentences).toHaveLength(3);
    expect(FURNISH.sentences[0]).toBe("Found a desk that fits under the window. $52 from Jun.");
    expect(new Set(ACTIVITY_LOG.map((entry) => entry.agent))).toEqual(new Set(AGENT_NAMES));
  });

  it("backs every PayPal moment with sandbox style IDs from the log", () => {
    const logIds = new Set(ACTIVITY_LOG.flatMap((entry) => (entry.paypal === undefined ? [] : [entry.paypal.id])));
    for (const moment of Object.values(PAYPAL_MOMENTS)) {
      expect(moment.references.length).toBeGreaterThan(0);
      for (const reference of moment.references) {
        expect(reference.id).toMatch(/^[0-9A-Z]{13,17}$/);
        expect(logIds.has(reference.id)).toBe(true);
      }
    }
  });

  it("raises exactly one item as next at handoff and explains the adjusted one", () => {
    expect(HANDOFF.items.filter((item) => item.check === "next")).toHaveLength(1);
    const adjusted = HANDOFF.items.filter((item) => item.check === "adjusted");
    expect(adjusted).toHaveLength(1);
    expect(adjusted[0].note).toBe("new 3 cm tear. You pay $30 of $35");
  });

  it("shows a made up Sell sample whose floor belongs to no listing", () => {
    expect(SELL).toMatchObject({ title: "Green glass banker's lamp", priceCents: 1_800, floorCents: 1_300, newCents: 4_500 });
    expect(SELL.facts.map((fact) => fact.value)).toEqual(["$13", "Good", "12 × 8.5 × 14 in", "May 10 to 14"]);
    expect(seedListings("2026-11-08").some((listing) => listing.title === SELL.title)).toBe(false);
  });
});
