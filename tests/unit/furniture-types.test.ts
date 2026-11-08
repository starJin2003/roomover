import { describe, expect, it } from "vitest";
import { FURNITURE, FURNITURE_TYPES, furnitureTypeFor } from "@/lib/domain/furniture";
import { seedListings } from "@/scripts/seed/listings";

const EXPECTED: Record<string, (typeof FURNITURE_TYPES)[number]> = {
  "Black balance arm desk lamp": "desk_lamp",
  "Large ivory floral area rug, 8 by 10 feet": "rug",
  "Three narrow beech bookcases": "bookcase",
  "Four drawer plastic storage tower": "drawer_unit",
  "Mesh back rolling desk chair": "desk_chair",
  "Green metal floor reading lamp, halogen bulb": "floor_lamp",
  "Vintage oak writing table with leather top": "desk",
  "Floor lamp with cream bell shade": "floor_lamp",
  "Mustard wingback lounge chair": "armchair",
  "Reversible comforter, blue and cream print": "comforter",
  "Three standard bed pillows": "pillows",
  "Five drawer desktop organizer, blue": "drawer_unit",
  "Black clamp lamp": "clamp_lamp",
  "Two woven grass baskets": "basket",
  "White three drawer desk with oak legs": "desk",
  "Black wood chair with red velvet seat": "side_chair",
  "Compact black fridge, 1.7 cubic feet": "mini_fridge",
  "Round jute and cotton rug, 4 feet": "round_rug",
  "Navy bean bag chair with matching pouf": "bean_bag",
  "Granny square crochet throw": "throw",
  "Brass table lamp with linen shade": "table_lamp",
  "Flat weave kilim rug, red and cream": "rug",
  "Three round felt poufs": "pouf",
  "Orange storage tote with attached lid": "tote",
};

describe("furnitureTypeFor", () => {
  const listings = seedListings("2026-11-08");

  it("maps every seed listing to a furniture type of its own category", () => {
    expect(listings).toHaveLength(24);
    for (const listing of listings) {
      const type = furnitureTypeFor(listing);
      expect(type, listing.title).toBe(EXPECTED[listing.title]);
      expect(FURNITURE[type].category, listing.title).toBe(listing.category);
    }
  });

  it("uses every furniture type at least once", () => {
    const used = new Set(listings.map((listing) => furnitureTypeFor(listing)));
    expect(FURNITURE_TYPES.filter((type) => !used.has(type))).toEqual([]);
  });

  it("matches keywords at the start of a word and falls back per category", () => {
    expect(furnitureTypeFor({ category: "storage", placement: "floor", title: "Oak cabinet with doors" })).toBe("drawer_unit");
    expect(furnitureTypeFor({ category: "storage", placement: "bed", title: "Clear storage bin" })).toBe("tote");
    expect(furnitureTypeFor({ category: "lamp", placement: "floor", title: "Arc lamp" })).toBe("floor_lamp");
    expect(furnitureTypeFor({ category: "lamp", placement: "surface", title: "Ceramic lamp" })).toBe("table_lamp");
    expect(furnitureTypeFor({ category: "chair", placement: "floor", title: "Folding chair" })).toBe("side_chair");
  });
});
