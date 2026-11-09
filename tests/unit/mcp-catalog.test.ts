import { describe, expect, it } from "vitest";
import type { PresetWithRules } from "@/lib/db/plans";
import { campusMatches, roomPresets, searchCatalog, searchListingsInput, type ListingExtras, type SearchScope } from "@/mcp/catalog";
import { CAMPUS, PRESET_SLUGS, UNIVERSITY } from "@/scripts/seed/campus";
import { seedHallRules, seedHalls, seedRoomPresets } from "@/scripts/seed/halls";
import { seedListings } from "@/scripts/seed/listings";
import { seedCatalog } from "./support/buyer-context";

function seedPresets(): PresetWithRules[] {
  const halls = seedHalls();
  const rules = seedHallRules();
  return seedRoomPresets().map((preset) => {
    const hall = halls.find((candidate) => candidate.id === preset.hallId);
    const rule = rules.find((candidate) => candidate.hallId === preset.hallId);
    if (hall === undefined || rule === undefined) throw new Error("Seed hall is missing.");
    return {
      id: preset.id,
      slug: preset.slug,
      name: preset.name,
      roomType: preset.roomType,
      campus: CAMPUS,
      hallName: hall.name,
      widthMm: preset.widthMm,
      depthMm: preset.depthMm,
      ceilingHeightMm: preset.ceilingHeightMm,
      geometry: preset.geometry,
      ruleText: rule.ruleText,
      constraints: rule.constraints,
    };
  });
}

const catalog = seedCatalog();
const extras = new Map<string, ListingExtras>(seedListings("2026-11-08").map((listing) => [listing.id, { handoffMode: listing.handoffMode, photoSrc: listing.photos[0].src }]));
const harbor = seedPresets().find((preset) => preset.slug === PRESET_SLUGS.harborDouble);
if (harbor === undefined) throw new Error("Harbor Hall preset is missing.");

const scope = (room: "harbor" | "none" = "none"): SearchScope => ({
  campusSlug: CAMPUS,
  campusName: UNIVERSITY,
  room: room === "harbor" ? { roomPresetId: harbor.id, roomNumber: "214", hallName: harbor.hallName, constraints: harbor.constraints } : null,
  appUrl: "https://roomover.example/",
});

describe("search_listings over MCP", () => {
  it("filters by category, price, and size in inches, cheapest first", () => {
    const results = searchCatalog(catalog, extras, scope(), searchListingsInput.parse({ category: "lamp", maxPriceDollars: 20, maxHeightInches: 30 }), null);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.category === "lamp" && result.priceCents <= 2_000)).toBe(true);
    const heights = results.map((result) => catalog.find((listing) => listing.id === result.listingId)?.heightMm ?? Infinity);
    expect(heights.every((height) => height <= 30 * 25.4)).toBe(true);
    expect(results.map((result) => result.priceCents)).toEqual([...results.map((result) => result.priceCents)].sort((a, b) => a - b));
  });

  it("keeps same room items for the student moving into that room only", () => {
    const sameRoom = catalog.filter((listing) => listing.sameRoom !== null).map((listing) => listing.id);
    expect(sameRoom.length).toBeGreaterThan(0);
    const anywhere = searchCatalog(catalog, extras, scope(), { limit: 24 }, null).map((result) => result.listingId);
    const harborRoom = searchCatalog(catalog, extras, scope("harbor"), { limit: 24 }, "Harbor Hall 214");
    expect(anywhere.some((id) => sameRoom.includes(id))).toBe(false);
    const kept = harborRoom.filter((result) => sameRoom.includes(result.listingId));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((result) => result.handoff.startsWith("Stays in Harbor Hall 214 for the student moving in there"))).toBe(true);
  });

  it("names the hall rule an item breaks once a room is given", () => {
    const [halogen] = searchCatalog(catalog, extras, scope("harbor"), { query: "halogen", category: "lamp" }, "Harbor Hall 214");
    expect(halogen.title).toMatch(/halogen/i);
    expect(halogen.breaksHallRule).toBe("Harbor Hall rule 1.1: Halogen lamps and bulbs are prohibited.");
    expect(searchCatalog(catalog, extras, scope(), { query: "halogen", category: "lamp" }, null)[0].breaksHallRule).toBeNull();
  });

  it("answers with sizes in both units, full photo URLs, and no floor price", () => {
    const [first] = searchCatalog(catalog, extras, scope(), { category: "desk" }, null);
    expect(first.size).toMatch(/^[\d.]+ × [\d.]+ × [\d.]+ in \([\d.]+ × [\d.]+ × [\d.]+ cm\)$/);
    expect(first.photoUrl).toMatch(/^https:\/\/roomover\.example\/seed\/listings\//);
    expect(JSON.stringify(first)).not.toMatch(/floor/i);
  });

  it("refuses inputs outside the schema", () => {
    expect(searchListingsInput.safeParse({ category: "sofa" }).success).toBe(false);
    expect(searchListingsInput.safeParse({ maxPriceDollars: -5 }).success).toBe(false);
    expect(searchListingsInput.safeParse({ limit: 100 }).success).toBe(false);
  });

  it("accepts the demo campus by slug or name", () => {
    expect(campusMatches(undefined, scope())).toBe(true);
    expect(campusMatches("lakeshore", scope())).toBe(true);
    expect(campusMatches("Lakeshore University", scope())).toBe(true);
    expect(campusMatches("Northwestern", scope())).toBe(false);
  });
});

describe("get_room_presets over MCP", () => {
  const demo = { presetSlug: PRESET_SLUGS.harborDouble, label: "Harbor Hall 214", student: "Jordan Ellis, the demo student," };

  it("lists every room with its size, what the university provides, and the hall's rules", () => {
    const rooms = roomPresets(seedPresets(), {}, demo);
    expect(rooms.map((room) => room.slug).sort()).toEqual(["birchwood-house-single", "breakwater-apartments-bedroom", "harbor-hall-double"]);
    const harborRoom = rooms.find((room) => room.slug === PRESET_SLUGS.harborDouble);
    expect(harborRoom?.size).toBe("3.6 by 4.5 m (11.8 by 14.8 ft)");
    expect(harborRoom?.windows).toBe(3);
    expect(harborRoom?.provided).toEqual(expect.arrayContaining(["2 beds", "2 desks", "2 wardrobes"]));
    expect(harborRoom?.hallRules.find((rule) => rule.section === "1.1")?.rule).toBe("Halogen lamps and bulbs are prohibited.");
    expect(harborRoom?.demoRoom).toBe("Jordan Ellis, the demo student, moves into Harbor Hall 214, a room of this kind, so plans for this preset furnish Harbor Hall 214.");
    expect(rooms.filter((room) => room.demoRoom !== null)).toHaveLength(1);
  });

  it("narrows to one hall by name", () => {
    expect(roomPresets(seedPresets(), { hall: "breakwater" }, demo).map((room) => room.slug)).toEqual(["breakwater-apartments-bedroom"]);
    expect(roomPresets(seedPresets(), { hall: "Elsewhere" }, demo)).toEqual([]);
  });
});
