import type { BuyerContext, CatalogListing } from "@/lib/agents/buyer/context";
import { handoffWindow } from "@/lib/domain/handoff";
import { listingColorsSchema } from "@/lib/domain/listing";
import { PRESET_SLUGS } from "@/scripts/seed/campus";
import { seedHallRules, seedRoomPresets } from "@/scripts/seed/halls";
import { seedId } from "@/scripts/seed/ids";
import { seedListings } from "@/scripts/seed/listings";
import { seedUsers } from "@/scripts/seed/people";

/** Seed data as the buyer agent sees it, with no database. */
export function seedCatalog(): CatalogListing[] {
  const names = new Map(seedUsers().map((user) => [user.id, user.displayName]));
  return seedListings("2026-11-08").map((listing) => ({
    id: listing.id,
    title: listing.title,
    description: listing.description,
    category: listing.category,
    placement: listing.placement ?? "floor",
    widthMm: listing.widthMm,
    depthMm: listing.depthMm,
    heightMm: listing.heightMm,
    specs: listing.specs ?? {},
    priceCents: listing.priceCents,
    newPriceCents: listing.retailReference.newPriceCents,
    condition: listing.conditionReport.grade,
    color: listing.color,
    colors: listingColorsSchema.parse(listing.colors),
    styleTags: listing.styleTags ?? [],
    sellerName: names.get(listing.sellerId) ?? "Unknown",
    pickup: handoffWindow(listing.handoffMode, listing),
  }));
}

export const listingId = (slug: string) => seedId("listing", slug);

/** Harbor Hall 214 for Jordan with a $150 budget and an empty plan. */
export function harborContext(overrides: Partial<BuyerContext> = {}): BuyerContext {
  const preset = seedRoomPresets().find((candidate) => candidate.slug === PRESET_SLUGS.harborDouble);
  const rules = seedHallRules().find((candidate) => candidate.hallId === preset?.hallId);
  if (preset === undefined || rules === undefined) throw new Error("Harbor Hall seed is missing.");
  return {
    hallName: "Harbor Hall",
    roomLabel: "Harbor Hall 214",
    presetName: preset.name,
    room: { widthMm: preset.widthMm, depthMm: preset.depthMm, ceilingHeightMm: preset.ceilingHeightMm, geometry: preset.geometry, egressPathMm: 915 },
    ruleText: rules.ruleText,
    constraints: rules.constraints,
    budgetCents: 15_000,
    buyerName: "Jordan Ellis",
    stylePrompt: "$150, cozy, I study late",
    catalog: new Map(seedCatalog().map((listing) => [listing.id, listing])),
    layout: { items: [] },
    announcedSkips: new Set(),
    now: new Date("2026-11-08T18:00:00Z"),
    ...overrides,
  };
}
