import { describe, expect, it } from "vitest";
import { ACTIVITY, CARD_SLUGS, LEDGER, LEDGER_SUMMARY, listingCard } from "@/app/style-guide/demo-data";
import { AGENT_NAMES } from "@/lib/domain/enums";
import { sumCents } from "@/lib/domain/money";

describe("style guide demo data", () => {
  it("conserves money across the settlement", () => {
    expect(sumCents(LEDGER.map((row) => row.beforeCents))).toBe(sumCents(LEDGER.map((row) => row.afterCents)));
    expect(LEDGER_SUMMARY.capturedCents + LEDGER_SUMMARY.releasedCents).toBe(LEDGER_SUMMARY.authorizedCents);
  });

  it("pays the platform and five distinct sellers", () => {
    expect(LEDGER).toHaveLength(6);
    expect(new Set(LEDGER.map((row) => row.account)).size).toBe(6);
  });

  it("shows every agent, and every PayPal step with an ID", () => {
    expect(new Set(ACTIVITY.map((entry) => entry.agent))).toEqual(new Set(AGENT_NAMES));
    for (const entry of ACTIVITY.filter((line) => line.paypal !== undefined)) {
      expect(entry.paypal?.id).toMatch(/^[0-9A-Z]{13,17}$/);
    }
  });

  it("builds listing cards from the seed catalog", () => {
    const cards = CARD_SLUGS.map(listingCard);
    expect(new Set(cards.map((card) => card.handoffMode))).toEqual(new Set(["direct", "same_room", "storage_hold"]));
    expect(cards[0]).toMatchObject({ title: "Black balance arm desk lamp", priceCents: 1_600, sellerName: "Ava Lindqvist" });
  });
});
