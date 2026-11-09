import { createHash } from "node:crypto";
import type { ListingCategory, Placement } from "@/lib/domain/enums";
import { furnitureTypeFor, nounFor, type FurnitureType } from "@/lib/domain/furniture";
import { retailerName } from "@/lib/domain/savings";
import type { SizeMmFields } from "@/lib/domain/sell";
import { candidatesFrom } from "./products";

/**
 * search_new_products. When no used listing covers a need, the buyer agent
 * searches Channel3's catalog by text, filtered by price and by the space
 * left in the room, and code keeps only new, in stock US offers that fit
 * those limits. Answers are cached by the query, so the same search costs
 * one credit once.
 */

/** Channel3 returns up to this many products, and code keeps the first few that fit. */
export const SEARCH_LIMIT = 10;
export const KEPT_PRODUCTS = 4;

export interface NewProductQuery {
  text: string;
  category: ListingCategory;
  maxPriceCents: number;
  maxWidthMm?: number;
  maxDepthMm?: number;
  maxHeightMm?: number;
}

export interface NewProduct {
  productId: string;
  title: string;
  /** The retailer's domain, such as target.com. */
  retailer: string;
  buyUrl: string;
  imageUrl: string | null;
  priceCents: number;
  sizeMm: SizeMmFields;
  /** False when the retailer stated no size and the room uses a typical one for the type. */
  sizeStated: boolean;
  category: ListingCategory;
  placement: Placement;
  furnitureType: FurnitureType;
  noun?: string;
}

/** Bedding drapes over the mattress whatever its flat size, so its search skips the size filter. */
const SIZE_FREE: ReadonlySet<ListingCategory> = new Set(["bed_accessory"]);

/** A size the room can draw when a retailer states none, in millimeters (width, depth, height). */
const TYPICAL_SIZE_MM: Readonly<Record<FurnitureType, readonly [number, number, number]>> = {
  comforter: [2030, 1520, 60],
  pillows: [660, 510, 150],
  throw: [1520, 1270, 20],
  desk: [1000, 500, 750],
  desk_chair: [600, 600, 950],
  side_chair: [500, 450, 820],
  armchair: [800, 750, 850],
  bean_bag: [800, 800, 700],
  pouf: [450, 450, 400],
  bookcase: [800, 300, 1800],
  desk_lamp: [200, 200, 450],
  table_lamp: [300, 300, 500],
  clamp_lamp: [150, 150, 300],
  floor_lamp: [350, 350, 1600],
  rug: [1830, 1220, 10],
  round_rug: [1220, 1220, 10],
  mini_fridge: [480, 450, 500],
  drawer_unit: [400, 360, 900],
  basket: [380, 380, 330],
  tote: [600, 400, 300],
  rolling_cart: [450, 350, 780],
  generic: [400, 400, 400],
};

export function normalizeQuery(query: NewProductQuery): NewProductQuery {
  const limit = (value: number | undefined) => (value === undefined ? undefined : Math.round(value));
  return {
    text: query.text.trim().toLowerCase().replace(/\s+/g, " "),
    category: query.category,
    maxPriceCents: Math.round(query.maxPriceCents),
    maxWidthMm: SIZE_FREE.has(query.category) ? undefined : limit(query.maxWidthMm),
    maxDepthMm: SIZE_FREE.has(query.category) ? undefined : limit(query.maxDepthMm),
    maxHeightMm: SIZE_FREE.has(query.category) ? undefined : limit(query.maxHeightMm),
  };
}

/** The cache key for a search, the same for any spelling of the same query. */
export function queryKey(query: NewProductQuery): string {
  const q = normalizeQuery(query);
  const canonical = JSON.stringify([q.text, q.category, q.maxPriceCents, q.maxWidthMm ?? null, q.maxDepthMm ?? null, q.maxHeightMm ?? null]);
  return createHash("sha256").update(canonical).digest("hex");
}

const cm = (mm: number) => Math.round(mm / 10);

/**
 * The Channel3 text search request. Retailers name the two floor sides
 * inconsistently, so both length and width are capped by the larger floor
 * limit and code checks the exact fit afterwards.
 */
export function searchRequest(query: NewProductQuery) {
  const q = normalizeQuery(query);
  const floorLimit = Math.max(q.maxWidthMm ?? 0, q.maxDepthMm ?? 0);
  const dimensions = {
    ...(floorLimit > 0 ? { length: { max: cm(floorLimit), unit: "cm" as const }, width: { max: cm(floorLimit), unit: "cm" as const } } : {}),
    ...(q.maxHeightMm !== undefined ? { height: { max: cm(q.maxHeightMm), unit: "cm" as const } } : {}),
  };
  return {
    query: q.text,
    limit: SEARCH_LIMIT,
    filters: {
      price: { max_price: q.maxPriceCents / 100 },
      ...(Object.keys(dimensions).length > 0 ? { dimensions } : {}),
    },
    config: { country: "US" as const, currency: "USD" as const, length_unit: "cm" as const },
  };
}

/** Where a new item goes in the room, from its category and title. */
export function placementFor(category: ListingCategory, title: string): Placement {
  switch (category) {
    case "bed_accessory":
      return "bed";
    case "rug":
      return "underlay";
    case "lamp":
      return /(^|[^a-z])floor/.test(title.toLowerCase()) ? "floor" : "surface";
    default:
      return "floor";
  }
}

function fits(size: SizeMmFields, query: NewProductQuery): boolean {
  if (SIZE_FREE.has(query.category)) return true;
  const floor = [size.widthMm, size.depthMm].sort((a, b) => b - a);
  const limits = [query.maxWidthMm ?? Infinity, query.maxDepthMm ?? Infinity].sort((a, b) => b - a);
  return floor[0] <= limits[0] && floor[1] <= limits[1] && size.heightMm <= (query.maxHeightMm ?? Infinity);
}

/** The products from a search response that fit the query's price and size, in Channel3's order. */
export function newProductsFrom(response: unknown, query: NewProductQuery, keep = KEPT_PRODUCTS): { products: NewProduct[]; productCount: number } {
  const q = normalizeQuery(query);
  const { candidates, productCount } = candidatesFrom(response, SEARCH_LIMIT);
  const products: NewProduct[] = [];
  for (const candidate of candidates) {
    if (candidate.newPriceCents > q.maxPriceCents || !candidate.url.startsWith("https://")) continue;
    const placement = placementFor(q.category, candidate.title);
    const furnitureType = furnitureTypeFor({ category: q.category, placement, title: candidate.title });
    const typical = TYPICAL_SIZE_MM[furnitureType];
    const sizeMm = candidate.sizeMm ?? { widthMm: typical[0], depthMm: typical[1], heightMm: typical[2] };
    if (!fits(sizeMm, q)) continue;
    products.push({
      productId: candidate.productId,
      title: candidate.title,
      retailer: retailerName(candidate.domain),
      buyUrl: candidate.url,
      imageUrl: candidate.imageUrl,
      priceCents: candidate.newPriceCents,
      sizeMm,
      sizeStated: candidate.sizeMm !== null,
      category: q.category,
      placement,
      furnitureType,
      ...nounFor(furnitureType, candidate.title),
    });
    if (products.length === keep) break;
  }
  return { products, productCount };
}
