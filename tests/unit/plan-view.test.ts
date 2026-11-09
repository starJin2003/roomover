import { describe, expect, it } from "vitest";
import { slotFor } from "@/lib/domain/handoff-slots";
import type { PlanLayout } from "@/lib/domain/layout";
import { buildPlanView, type PlanListing, type PlanMeta, type PlanNegotiation } from "@/lib/plan-view";
import { HARBOR_214_DEMO_LAYOUT } from "@/scripts/seed/layouts";
import { listingId, seedCatalog } from "./support/buyer-context";

const META: PlanMeta = { id: "plan", status: "ready", presetSlug: "harbor-hall-double", roomLabel: "Harbor Hall 214", budgetCents: 15_000, stylePrompt: "$150, cozy" };

const listings = new Map<string, PlanListing>(
  seedCatalog().map((listing) => [
    listing.id,
    {
      id: listing.id,
      title: listing.title,
      conditionGrade: listing.condition,
      priceCents: listing.priceCents,
      channel3NewCents: listing.newPriceCents,
      sellerName: listing.sellerName,
      color: listing.color,
      colors: listing.colors,
    },
  ]),
);

const DESK = listingId("jun-white-desk");
const SLOT = slotFor({ day: "2026-11-23", startHour: 14 });
const json = { startsAt: SLOT.startsAt.toISOString(), endsAt: SLOT.endsAt.toISOString() };

const NEW_THROW: PlanLayout["items"][number] = {
  key: "new-sherpa-throw",
  source: "new_product",
  channel3ProductId: "c3-throw",
  productName: "Sherpa fleece throw blanket",
  priceCents: 2_500,
  category: "bed_accessory",
  retailer: "target.com",
  buyUrl: "https://buy.trychannel3.com/c3-throw",
  furnitureType: "throw",
  placement: "bed",
  widthMm: 1_520,
  depthMm: 1_270,
  heightMm: 20,
  pieces: 1,
  xMm: 600,
  yMm: 1_500,
  elevationMm: 559,
  rotationDeg: 0,
};

describe("buildPlanView", () => {
  it("joins the layout to listings and adds up what the used items cost", () => {
    const view = buildPlanView(META, HARBOR_214_DEMO_LAYOUT, listings, null);
    expect(view.items.map((item) => item.title)).toEqual([
      "White three drawer desk with oak legs",
      "Mesh back rolling desk chair",
      "Black balance arm desk lamp",
      "Black clamp lamp",
      "Navy bean bag chair with matching pouf",
    ]);
    expect(view.totalCents).toBe(5_500 + 3_500 + 1_600 + 800 + 3_000);
    expect(view.usedCents).toBe(view.totalCents);
    expect(view.newItemsCents).toBe(0);
    expect(view.savings.compared).toBe(5);
    expect(view.savings.savedCents).toBeGreaterThan(0);
    expect(view.items[0]).toMatchObject({ condition: "Good", sellerName: "Jun Park", colors: [{ name: "white" }, { name: "light oak legs" }] });
  });

  it("charges the agreed price, shows the asking price beside it, and names the agreed slot", () => {
    const negotiation: PlanNegotiation = {
      listingId: DESK,
      status: "agreed",
      offers: [
        { round: 1, from: "buyer", action: "offer", priceCents: 4_500, handoffSlot: json, message: "Offer of $45.", at: json.startsAt },
        { round: 1, from: "seller", action: "counter", priceCents: 4_800, handoffSlot: json, message: "Could you do $48?", at: json.startsAt },
        { round: 1, from: "buyer", action: "accept", priceCents: 4_800, handoffSlot: json, message: "Accepted $48.", at: json.startsAt },
      ],
      agreedPriceCents: 4_800,
      agreedSlot: SLOT,
    };
    const view = buildPlanView(META, HARBOR_214_DEMO_LAYOUT, listings, null, null, [negotiation]);
    expect(view.items[0]).toMatchObject({ priceCents: 4_800, listPriceCents: 5_500, slotLabel: "Mon Nov 23, 2 to 4 PM" });
    expect(view.usedCents).toBe(4_800 + 3_500 + 1_600 + 800 + 3_000);
    expect(view.negotiations).toEqual([
      {
        listingIds: [DESK],
        titles: ["White three drawer desk with oak legs"],
        sellerName: "Jun Park",
        status: "agreed",
        askingCents: 5_500,
        agreedCents: 4_800,
        slot: "Mon Nov 23, 2 to 4 PM",
        rounds: [
          { round: 1, from: "buyer", action: "offer", priceCents: 4_500, slot: "Mon Nov 23, 2 to 4 PM", message: "Offer of $45.", heldByCode: null },
          { round: 1, from: "seller", action: "counter", priceCents: 4_800, slot: "Mon Nov 23, 2 to 4 PM", message: "Could you do $48?", heldByCode: null },
          { round: 1, from: "buyer", action: "accept", priceCents: 4_800, slot: "Mon Nov 23, 2 to 4 PM", message: "Accepted $48.", heldByCode: null },
        ],
      },
    ]);
  });

  it("marks a new item with its retailer and keeps it out of the PayPal amount", () => {
    const view = buildPlanView(META, { items: [...HARBOR_214_DEMO_LAYOUT.items, NEW_THROW] }, listings, null);
    expect(view.items.at(-1)).toMatchObject({ title: "Sherpa fleece throw blanket", condition: "New from target.com", newFrom: { retailer: "target.com", buyUrl: "https://buy.trychannel3.com/c3-throw" } });
    expect(view.newItemsCents).toBe(2_500);
    expect(view.usedCents).toBe(14_400);
    expect(view.totalCents).toBe(16_900);
    expect(view.savings.total).toBe(5);
  });

  it("leaves out items whose listing it cannot find", () => {
    const [first] = HARBOR_214_DEMO_LAYOUT.items;
    const view = buildPlanView(META, HARBOR_214_DEMO_LAYOUT, new Map([...listings].filter(([id]) => first.source === "listing" && id === first.listingId)), null);
    expect(view.items).toHaveLength(1);
    expect(view.totalCents).toBe(5_500);
  });
});
