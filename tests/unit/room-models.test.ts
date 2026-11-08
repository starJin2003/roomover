import { describe, expect, it } from "vitest";
import { furnitureTypeFor } from "@/lib/domain/furniture";
import { rowWidthMm } from "@/lib/domain/layout";
import { buildFixture } from "@/components/room/model/fixtures";
import { buildFurniture } from "@/components/room/model/furniture";
import { modelExtent } from "@/components/room/model/parts";
import { buildShell, roomView } from "@/components/room/model/shell";
import { tonesForColor } from "@/components/room/model/tones";
import { seedRoomPresets } from "@/scripts/seed/halls";
import { seedListings } from "@/scripts/seed/listings";

const BEDDING = new Set(["comforter", "pillows", "throw"]);

describe("furniture models", () => {
  const listings = seedListings("2026-11-08").filter((listing) => !BEDDING.has(furnitureTypeFor(listing)));

  it.each(listings.map((listing) => [listing.title, listing] as const))("%s stays inside its listed size and fills it", (_title, listing) => {
    const type = furnitureTypeFor(listing);
    const pieces = listing.specs?.pieces ?? 1;
    const size = { width: listing.widthMm, depth: listing.depthMm, height: listing.heightMm };
    const extent = modelExtent(buildFurniture(type, size, pieces, tonesForColor(listing.color)));
    const row = rowWidthMm({ widthMm: size.width, pieces });

    expect(extent.min[0]).toBeGreaterThanOrEqual(-row / 2 - 1);
    expect(extent.max[0]).toBeLessThanOrEqual(row / 2 + 1);
    expect(extent.min[1]).toBeGreaterThanOrEqual(-1);
    expect(extent.max[1]).toBeLessThanOrEqual(size.height + 1);
    expect(extent.min[2]).toBeGreaterThanOrEqual(-size.depth / 2 - 1);
    expect(extent.max[2]).toBeLessThanOrEqual(size.depth / 2 + 1);

    expect(extent.max[1] - extent.min[1]).toBeGreaterThanOrEqual(size.height * 0.95);
    const across = Math.max(extent.max[0] - extent.min[0], extent.max[2] - extent.min[2]);
    expect(across).toBeGreaterThanOrEqual(Math.max(row, size.depth) * 0.9);
  });

  it("drapes bedding over the mattress it lies on", () => {
    const comforter = modelExtent(buildFurniture("comforter", { width: 2030, depth: 2290, height: 40 }, 1, ["linen", "paper"], { width: 914, length: 2032 }));
    expect(comforter.max[0] - comforter.min[0]).toBeGreaterThan(914);
    expect(comforter.max[0] - comforter.min[0]).toBeLessThan(1000);
    expect(comforter.min[1]).toBeLessThan(-200);
    const pillows = buildFurniture("pillows", { width: 510, depth: 660, height: 150 }, 3, ["paper"], { width: 914, length: 2032 });
    expect(pillows).toHaveLength(3);
  });
});

describe("tonesForColor", () => {
  it("maps listing colors to palette tones in the seller's order", () => {
    expect(tonesForColor("black and brass")).toEqual(["graphite", "oak"]);
    expect(tonesForColor("white and light oak")).toEqual(["paper", "oak"]);
    expect(tonesForColor("honey oak and dark green")).toEqual(["oak", "graphite"]);
    expect(tonesForColor("light blue and cream")).toEqual(["linen", "paper"]);
    expect(tonesForColor("pink, teal, green, and orange")).toEqual(["sand", "stone", "oak"]);
    expect(tonesForColor("navy")).toEqual(["flint"]);
    expect(tonesForColor("charcoal, red, and orange")).toEqual(["flint", "stone", "oak"]);
    expect(tonesForColor("chartreuse")).toEqual(["stone"]);
  });
});

describe("room models", () => {
  const presets = seedRoomPresets();

  it("keeps the window wall at the back and adds the door wall when the two meet", () => {
    expect(presets.map((preset) => [preset.slug, roomView(preset.geometry).backWalls])).toEqual([
      ["harbor-hall-double", ["north", "west"]],
      ["birchwood-house-single", ["north", "west"]],
      ["breakwater-apartments-bedroom", ["north", "east"]],
    ]);
    expect(roomView(presets[2].geometry).toward).toEqual({ x: -1, z: 1 });
  });

  it("builds provided furniture inside its published size, with bed head posts above the mattress", () => {
    for (const fixture of presets.flatMap((preset) => preset.geometry.fixtures)) {
      const extent = modelExtent(buildFixture(fixture));
      const allowance = fixture.kind === "bed" ? 200 : 1;
      expect(extent.max[0] - extent.min[0], fixture.label).toBeLessThanOrEqual(fixture.widthMm + 1);
      expect(extent.max[2] - extent.min[2], fixture.label).toBeLessThanOrEqual(fixture.depthMm + 1);
      expect(extent.max[1], fixture.label).toBeLessThanOrEqual(fixture.heightMm + allowance);
      expect(extent.max[1], fixture.label).toBeGreaterThanOrEqual(fixture.heightMm * 0.97);
    }
  });

  it("stands the walls at ceiling height on a slab under the floor", () => {
    for (const preset of presets) {
      const extent = modelExtent(buildShell(preset, roomView(preset.geometry)));
      expect(extent.max[1]).toBe(preset.ceilingHeightMm);
      expect(extent.min[1]).toBe(-180);
      expect(extent.max[0] - extent.min[0]).toBeGreaterThan(preset.widthMm);
      expect(extent.max[2] - extent.min[2]).toBeGreaterThan(preset.depthMm);
    }
  });
});
