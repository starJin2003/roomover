import { describe, expect, it } from "vitest";
import { buildPlanView, type PlanListing, type PlanMeta } from "@/lib/plan-view";
import { HARBOR_214_DEMO_LAYOUT } from "@/scripts/seed/layouts";
import { seedCatalog } from "./support/buyer-context";

const META: PlanMeta = { id: "plan", status: "ready", presetSlug: "harbor-hall-double", roomLabel: "Harbor Hall 214", budgetCents: 15_000, stylePrompt: "$150, cozy" };

const listings = new Map<string, PlanListing>(
  seedCatalog().map((listing) => [
    listing.id,
    {
      id: listing.id,
      title: listing.title,
      conditionGrade: listing.condition,
      priceCents: listing.priceCents,
      newPriceCents: listing.newPriceCents,
      sellerName: listing.sellerName,
      color: listing.color,
      colors: listing.colors,
    },
  ]),
);

describe("buildPlanView", () => {
  it("joins the layout to listings and adds up what it costs used and new", () => {
    const view = buildPlanView(META, HARBOR_214_DEMO_LAYOUT, listings, null);
    expect(view.items.map((item) => item.title)).toEqual([
      "White three drawer desk with oak legs",
      "Mesh back rolling desk chair",
      "Black balance arm desk lamp",
      "Black clamp lamp",
      "Navy bean bag chair with matching pouf",
    ]);
    expect(view.totalCents).toBe(5_500 + 3_500 + 1_600 + 800 + 3_000);
    expect(view.newCents).toBeGreaterThan(view.totalCents);
    expect(view.items[0]).toMatchObject({ condition: "Good", sellerName: "Jun Park", colors: [{ name: "white" }, { name: "light oak legs" }] });
  });

  it("leaves out items whose listing it cannot find", () => {
    const [first] = HARBOR_214_DEMO_LAYOUT.items;
    const view = buildPlanView(META, HARBOR_214_DEMO_LAYOUT, new Map([...listings].filter(([id]) => first.source === "listing" && id === first.listingId)), null);
    expect(view.items).toHaveLength(1);
    expect(view.totalCents).toBe(5_500);
  });
});
