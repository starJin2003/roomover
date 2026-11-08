import { describe, expect, it } from "vitest";
import { checkLayout } from "@/lib/domain/fit";
import { planLayoutSchema } from "@/lib/domain/layout";
import { seedRoomPresets } from "@/scripts/seed/halls";
import { DEMO_PRESET_SLUG, HARBOR_214_DEMO_LAYOUT, TEST_LAYOUTS } from "@/scripts/seed/layouts";
import { seedListings } from "@/scripts/seed/listings";

const presets = seedRoomPresets();
const listings = seedListings("2026-11-08");
const room = (slug: string) => {
  const preset = presets.find((candidate) => candidate.slug === slug);
  if (preset === undefined) throw new Error(`No preset ${slug}.`);
  return { widthMm: preset.widthMm, depthMm: preset.depthMm, ceilingHeightMm: preset.ceilingHeightMm, geometry: preset.geometry };
};

describe("seed layouts", () => {
  it("place every seed listing exactly once across the three presets", () => {
    const placed = Object.values(TEST_LAYOUTS).flatMap((layout) =>
      layout.items.flatMap((item) => (item.source === "listing" ? [item.listingId] : [])),
    );
    expect(placed).toHaveLength(24);
    expect(new Set(placed)).toEqual(new Set(listings.map((listing) => listing.id)));
    expect(Object.keys(TEST_LAYOUTS).sort()).toEqual(presets.map((preset) => preset.slug).sort());
  });

  it.each(Object.entries(TEST_LAYOUTS))("%s passes the fit check with no problems", (slug, layout) => {
    expect(planLayoutSchema.safeParse(layout).success).toBe(true);
    expect(checkLayout(room(slug), layout).problems).toEqual([]);
  });

  it("copies each listing's size and piece count", () => {
    const byId = new Map(listings.map((listing) => [listing.id, listing]));
    for (const item of Object.values(TEST_LAYOUTS).flatMap((layout) => layout.items)) {
      if (item.source !== "listing") continue;
      const listing = byId.get(item.listingId);
      expect([item.widthMm, item.depthMm, item.heightMm, item.placement]).toEqual([listing?.widthMm, listing?.depthMm, listing?.heightMm, listing?.placement]);
      expect(item.pieces).toBe(listing?.specs?.pieces ?? 1);
    }
  });

  it("gives Harbor Hall 214 the five seller winter cart, with the bean bag landing last", () => {
    expect(checkLayout(room(DEMO_PRESET_SLUG), HARBOR_214_DEMO_LAYOUT).fits).toBe(true);
    const sellers = HARBOR_214_DEMO_LAYOUT.items.map((item) => listings.find((listing) => item.source === "listing" && listing.id === item.listingId)?.sellerId);
    expect(new Set(sellers).size).toBe(5);
    expect(HARBOR_214_DEMO_LAYOUT.items.map((item) => item.key)).toEqual([
      "jun-white-desk",
      "marcus-mesh-desk-chair",
      "ava-desk-lamp",
      "sofia-clamp-lamp",
      "lea-navy-bean-bag",
    ]);
  });
});
