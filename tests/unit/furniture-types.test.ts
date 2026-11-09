import { describe, expect, it } from "vitest";
import { FURNITURE, FURNITURE_TYPES, furnitureTypeFor, nounFor, nounFromTitle } from "@/lib/domain/furniture";
import { layoutItemFor } from "@/lib/domain/placement";
import { itemNoun, withArticle } from "@/lib/domain/room-words";
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

  it("uses every furniture type but the cart and the generic shape, which Sell listings and the fallback reach", () => {
    const used = new Set(listings.map((listing) => furnitureTypeFor(listing)));
    expect(FURNITURE_TYPES.filter((type) => !used.has(type))).toEqual(["rolling_cart", "generic"]);
  });

  it("matches keywords at the start of a word", () => {
    expect(furnitureTypeFor({ category: "storage", placement: "bed", title: "Clear storage bin" })).toBe("tote");
    expect(furnitureTypeFor({ category: "lamp", placement: "floor", title: "Arc lamp" })).toBe("floor_lamp");
    expect(furnitureTypeFor({ category: "lamp", placement: "surface", title: "Ceramic lamp" })).toBe("table_lamp");
    expect(furnitureTypeFor({ category: "chair", placement: "floor", title: "Folding chair" })).toBe("side_chair");
    expect(furnitureTypeFor({ category: "shelf", placement: "floor", title: "Five cube shelving unit" })).toBe("bookcase");
  });

  it("draws the Sell samples as their own types", () => {
    expect(furnitureTypeFor({ category: "storage", placement: "floor", title: "Black rolling cart" })).toBe("rolling_cart");
    expect(furnitureTypeFor({ category: "chair", placement: "floor", title: "White tufted side chair" })).toBe("side_chair");
    expect(furnitureTypeFor({ category: "storage", placement: "floor", title: "Blue laundry basket" })).toBe("basket");
    expect(FURNITURE.rolling_cart).toMatchObject({ category: "storage", host: true });
  });

  it("falls back to the generic shape for a title no type of its category describes", () => {
    expect(furnitureTypeFor({ category: "storage", placement: "floor", title: "Oak cabinet with doors" })).toBe("generic");
    expect(furnitureTypeFor({ category: "chair", placement: "floor", title: "Wooden step stool" })).toBe("generic");
    expect(furnitureTypeFor({ category: "lamp", placement: "wall", title: "Warm string lights" })).toBe("generic");
    expect(FURNITURE.generic.category).toBeNull();
  });
});

describe("generic shape naming", () => {
  it("names the item after its listing, never after another type", () => {
    expect(nounFromTitle("Oak cabinet with doors")).toBe("oak cabinet");
    expect(nounFromTitle("Wooden step stool, folds flat")).toBe("wooden step stool");
    expect(nounFromTitle("LED string lights")).toBe("LED string lights");
    expect(nounFor("generic", "Oak cabinet with doors")).toEqual({ noun: "oak cabinet" });
    expect(nounFor("rolling_cart", "Black rolling cart")).toEqual({});
  });

  it("carries the listing's own noun into the layout item and every sentence", () => {
    const cabinet = { id: "44444444-4444-4444-8444-444444444444", title: "Oak cabinet with doors", category: "storage" as const, placement: "floor" as const, widthMm: 800, depthMm: 400, heightMm: 900, specs: {} };
    const item = layoutItemFor(cabinet, { xMm: 1000, yMm: 1000, rotationDeg: 0 }, { items: [] });
    expect(item).toMatchObject({ furnitureType: "generic", noun: "oak cabinet" });
    expect(withArticle(itemNoun(item))).toBe("an oak cabinet");
    const cart = layoutItemFor({ ...cabinet, title: "Black rolling cart" }, { xMm: 1000, yMm: 1000, rotationDeg: 0 }, { items: [] });
    expect(cart.noun).toBeUndefined();
    expect(itemNoun(cart)).toBe("rolling cart");
  });
});
