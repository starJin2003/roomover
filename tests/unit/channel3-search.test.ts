import { describe, expect, it } from "vitest";
import { newProductsFrom, normalizeQuery, placementFor, queryKey, searchRequest, type NewProductQuery } from "@/lib/channel3/search";
import { newItemLabel, referencePriceCents, retailerName, usedSavings } from "@/lib/domain/savings";

function product(id: string, title: string, price: number, options: { domain?: string; dims?: [number, number, number] | null; currency?: string; condition?: string } = {}) {
  const dims = options.dims === undefined ? null : options.dims;
  return {
    id,
    title,
    brands: [{ id: "b", name: "Brand" }],
    images: [{ url: `https://cdn.trychannel3.com/${id}`, is_main_image: true }],
    offers: [
      {
        url: `https://buy.trychannel3.com/${id}`,
        domain: options.domain ?? "www.target.com",
        price: { price, currency: options.currency ?? "USD" },
        availability: "InStock",
        condition: options.condition ?? "new",
        dimensions:
          dims === null
            ? { length: null, width: null, height: null }
            : { length: { number: dims[0], unit: "cm" }, width: { number: dims[1], unit: "cm" }, height: { number: dims[2], unit: "cm" } },
      },
    ],
  };
}

const RUG_QUERY: NewProductQuery = { text: "  Small  Round RUG ", category: "rug", maxPriceCents: 3_500, maxWidthMm: 1_300, maxDepthMm: 1_300 };

describe("search_new_products request and cache key", () => {
  it("filters Channel3 by price and by the space the spot allows", () => {
    expect(searchRequest(RUG_QUERY)).toEqual({
      query: "small round rug",
      limit: 10,
      filters: { price: { max_price: 35 }, dimensions: { length: { max: 130, unit: "cm" }, width: { max: 130, unit: "cm" } } },
      config: { country: "US", currency: "USD", length_unit: "cm" },
    });
  });

  it("skips the size filter for bedding, which drapes over the mattress", () => {
    const request = searchRequest({ text: "throw blanket", category: "bed_accessory", maxPriceCents: 3_000, maxWidthMm: 900 });
    expect(request.filters).toEqual({ price: { max_price: 30 } });
  });

  it("gives the same key to any spelling of the same query and a new key when a limit changes", () => {
    const key = queryKey(RUG_QUERY);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(queryKey({ ...RUG_QUERY, text: "small round rug" })).toBe(key);
    expect(queryKey({ ...RUG_QUERY, maxPriceCents: 3_600 })).not.toBe(key);
    expect(normalizeQuery(RUG_QUERY).text).toBe("small round rug");
  });
});

describe("search_new_products parsing", () => {
  const response = {
    products: [
      product("big", "Round jute rug 6 ft", 32, { dims: [183, 183, 1] }),
      product("pricey", "Round wool rug 4 ft", 60, { dims: [122, 122, 1] }),
      product("eur", "Round rug 4 ft", 20, { dims: [120, 120, 1], currency: "EUR" }),
      product("used", "Round rug 4 ft", 15, { dims: [120, 120, 1], condition: "used" }),
      product("fits", "Round cotton rug 4 ft", 29, { dims: [122, 122, 1], domain: "www.Target.com" }),
      product("unstated", "Round braided rug", 25),
      { id: "broken", title: 7 },
    ],
  };

  it("keeps new US offers within the price and the size, in Channel3's order", () => {
    const { products, productCount } = newProductsFrom(response, RUG_QUERY);
    expect(productCount).toBe(7);
    expect(products.map((item) => item.productId)).toEqual(["fits", "unstated"]);
    expect(products[0]).toMatchObject({
      title: "Round cotton rug 4 ft",
      retailer: "target.com",
      buyUrl: "https://buy.trychannel3.com/fits",
      priceCents: 2_900,
      sizeMm: { widthMm: 1_220, depthMm: 1_220, heightMm: 10 },
      sizeStated: true,
      placement: "underlay",
      furnitureType: "round_rug",
    });
  });

  it("gives a product with no stated size a typical one for its type", () => {
    const [, unstated] = newProductsFrom(response, RUG_QUERY).products;
    expect(unstated).toMatchObject({ sizeStated: false, sizeMm: { widthMm: 1_220, depthMm: 1_220, heightMm: 10 } });
  });

  it("names a product of no known type after itself", () => {
    const { products } = newProductsFrom({ products: [product("hamper", "Collapsible laundry hamper", 18), product("stool", "Wooden step stool", 22, { dims: [40, 30, 45] })] }, { text: "storage", category: "storage", maxPriceCents: 3_000 });
    expect(products.map((item) => [item.furnitureType, item.noun])).toEqual([
      ["basket", undefined],
      ["generic", "wooden step stool"],
    ]);
  });

  it("places lamps by what the title says", () => {
    expect(placementFor("lamp", "Arc floor lamp")).toBe("floor");
    expect(placementFor("lamp", "Ceramic table lamp")).toBe("surface");
    expect(placementFor("bed_accessory", "Throw")).toBe("bed");
  });
});

describe("savings and new item marking", () => {
  it("sums what the used items save against Channel3's new prices", () => {
    expect(
      usedSavings([
        { listingId: "a", paidCents: 4_800, newCents: 19_900 },
        { listingId: "b", paidCents: 1_500, newCents: 1_200 },
        { listingId: "c", paidCents: 2_000, newCents: null },
      ]),
    ).toEqual({ paidCents: 6_300, newCents: 21_100, savedCents: 15_100, compared: 2, total: 3 });
  });

  it("takes the cheapest comparable new price, so savings are never inflated", () => {
    expect(referencePriceCents([38_500, 4_900, 5_900])).toBe(4_900);
    expect(referencePriceCents([0, -5, 2_200])).toBe(2_200);
    expect(referencePriceCents([])).toBeNull();
  });

  it("marks a new item with its retailer", () => {
    expect(retailerName(" WWW.Target.com ")).toBe("target.com");
    expect(newItemLabel("target.com")).toBe("New from target.com");
  });
});
