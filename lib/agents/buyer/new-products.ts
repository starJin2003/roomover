import { z } from "zod";
import type { NewProduct } from "@/lib/channel3/search";
import { LISTING_CATEGORIES, type ListingCategory } from "@/lib/domain/enums";
import { checkFit } from "@/lib/domain/fit";
import { hallRuleViolations, type RuleListing } from "@/lib/domain/hall-check";
import type { LayoutItem, PlanLayout } from "@/lib/domain/layout";
import { itemKeyFor, moveItem, putItem, settle } from "@/lib/domain/placement";
import { QUARTER_TURNS } from "@/lib/domain/room";
import { itemNoun, whereIs } from "@/lib/domain/room-words";
import { formatUsdShort } from "@/lib/format";
import { planTotalCents, priceFor, type BuyerContext, type CatalogListing, type EventDraft } from "./context";

/**
 * search_new_products and place_new_product. When a need has no used
 * listing that fits the budget, the hall rules, and the room, the buyer
 * agent searches Channel3 and places a new product. The student buys it
 * from the retailer, so it never joins the PayPal order, and it still
 * counts against the budget because the room needs it.
 */

const usd = formatUsdShort;

const CATEGORY_NOUN: Readonly<Record<ListingCategory, string>> = {
  bed_accessory: "bedding",
  desk: "desk",
  chair: "chair",
  shelf: "bookcase",
  lamp: "lamp",
  rug: "rug",
  mini_fridge: "mini fridge",
  storage: "storage piece",
};

const sizeLimit = (what: string) => z.number().int().min(100).max(5_000).optional().describe(`The most ${what} the spot allows, in millimeters.`);

export const searchNewProductsInput = z.strictObject({
  category: z.enum(LISTING_CATEGORIES),
  query: z.string().min(2).max(60).describe("A few plain words for the product, such as \"throw blanket\" or \"small round rug\"."),
  maxPriceDollars: z.number().int().positive().optional().describe("The most to spend. Defaults to the budget left, which is also the ceiling."),
  maxWidthMm: sizeLimit("width"),
  maxDepthMm: sizeLimit("depth"),
  maxHeightMm: sizeLimit("height"),
});

export const placeNewProductInput = z.strictObject({
  productId: z.string().min(1).describe("The productId from search_new_products."),
  xMm: z.number().int().min(0).max(20_000).describe("Center of the item's footprint, millimeters east of the west wall."),
  yMm: z.number().int().min(0).max(20_000).describe("Center of the item's footprint, millimeters south of the north wall."),
  rotationDeg: z.literal(QUARTER_TURNS).describe("Clockwise turn seen from above. 0 faces the item's front south."),
  reason: z.string().min(1).max(160).describe("One short sentence on why this product and spot suit the student."),
});

export interface NewProductOutcome {
  result: unknown;
  events: EventDraft[];
  layout?: PlanLayout;
}

const remainingCents = (context: BuyerContext, layout: PlanLayout = context.layout) => context.budgetCents - planTotalCents(layout, context.catalog, context.negotiations);

function placed(context: BuyerContext): CatalogListing[] {
  return context.layout.items.flatMap((item) => {
    const listing = item.source === "listing" ? context.catalog.get(item.listingId) : undefined;
    return listing === undefined ? [] : [listing];
  });
}

/** A same room listing stays in its room, so only the student moving into that room may buy it. */
export function offeredTo(context: Pick<BuyerContext, "roomPresetId" | "roomNumber">, listing: CatalogListing): boolean {
  return listing.sameRoom === null || (listing.sameRoom.roomPresetId === context.roomPresetId && listing.sameRoom.roomNumber === context.roomNumber);
}

/** Used listings of a category the student could still get: offered to this room, inside the budget, within the rules, and not refused by the room. */
export function usedOptions(context: BuyerContext, category: ListingCategory): CatalogListing[] {
  const inPlan = new Set(placed(context).map((listing) => listing.id));
  const left = remainingCents(context);
  return [...context.catalog.values()].filter(
    (listing) =>
      listing.category === category &&
      !inPlan.has(listing.id) &&
      offeredTo(context, listing) &&
      priceFor(context, listing.id) <= left &&
      !context.fitFailures.has(listing.id) &&
      hallRuleViolations(context.constraints, listing, placed(context)).length === 0,
  );
}

const productView = (product: NewProduct) => ({
  productId: product.productId,
  title: product.title,
  retailer: product.retailer,
  priceCents: product.priceCents,
  sizeMm: [product.sizeMm.widthMm, product.sizeMm.depthMm, product.sizeMm.heightMm],
  sizeStated: product.sizeStated,
  placement: product.placement,
});

export async function searchNewProducts(context: BuyerContext, input: z.infer<typeof searchNewProductsInput>): Promise<NewProductOutcome> {
  const refuse = (problem: string, listingIds?: string[]): NewProductOutcome => ({
    result: { searched: false, problems: [problem] },
    events: [{ tool: "search_new_products", blocked: true, summary: `Did not search Channel3. ${problem}`, detail: { problems: [problem], ...(listingIds ? { listingIds } : {}) } }],
  });
  if (context.channel3 === undefined) return refuse("Channel3 is not available in this run.");
  const options = usedOptions(context, input.category);
  if (options.length > 0) {
    const titles = options.slice(0, 4).map((listing) => `${listing.title} (${listing.id})`);
    return refuse(`Used listings in ${input.category} still fit: ${titles.join(", ")}. Try them first, and search Channel3 only when none fits the room, the budget, and the rules.`, options.slice(0, 12).map((listing) => listing.id));
  }
  const left = remainingCents(context);
  if (left <= 0) return refuse("The budget is spent.");
  const maxPriceCents = Math.min(left, input.maxPriceDollars === undefined ? left : input.maxPriceDollars * 100);
  const query = { text: input.query, category: input.category, maxPriceCents, maxWidthMm: input.maxWidthMm, maxDepthMm: input.maxDepthMm, maxHeightMm: input.maxHeightMm };
  const search = await context.channel3.search(query);
  if (!search.ok) return refuse(search.problem);
  for (const product of search.products) context.newProducts.set(product.productId, product);
  const size = [input.maxWidthMm, input.maxDepthMm, input.maxHeightMm].some((value) => value !== undefined)
    ? `, at most ${[input.maxWidthMm, input.maxDepthMm, input.maxHeightMm].map((value) => (value === undefined ? "any" : `${value}`)).join(" by ")} mm`
    : "";
  const filters = `under ${usd(maxPriceCents)}${size}`;
  const noun = CATEGORY_NOUN[input.category];
  return {
    result: { searched: true, products: search.products.map(productView), credits: search.credits, budgetLeftCents: left },
    events: [
      {
        tool: "search_new_products",
        summary: `Searched Channel3 for "${input.query}" ${filters} and kept ${search.products.length} of ${search.productCount} products that fit${search.cached ? ", answered from the cache" : ""}.`,
        sentence: search.products.length > 0 ? `Checking new ${noun === "bedding" ? "bedding" : `${noun}s`} on Channel3.` : `Channel3 has no new ${noun} that fits the room and the budget.`,
        detail: {
          count: search.products.length,
          latencyMs: search.latencyMs,
          channel3: {
            query: input.query,
            filters,
            credits: search.credits,
            cached: search.cached,
            productCount: search.productCount,
            products: search.products.map((product) => ({ title: product.title, priceCents: product.priceCents, retailer: product.retailer })),
            keys: [search.queryKey],
          },
        },
      },
    ],
  };
}

function ruleListingOf(product: NewProduct): RuleListing {
  return {
    id: product.productId,
    title: product.title,
    description: product.title,
    category: product.category,
    placement: product.placement,
    widthMm: product.sizeMm.widthMm,
    depthMm: product.sizeMm.depthMm,
    heightMm: product.sizeMm.heightMm,
    specs: {},
  };
}

export function newItemFor(product: NewProduct, spot: { xMm: number; yMm: number; rotationDeg: number }, layout: PlanLayout): LayoutItem {
  return {
    key: itemKeyFor(`new ${product.title}`, layout, product.productId),
    source: "new_product",
    channel3ProductId: product.productId,
    productName: product.title,
    priceCents: product.priceCents,
    category: product.category,
    retailer: product.retailer,
    buyUrl: product.buyUrl,
    furnitureType: product.furnitureType,
    ...(product.noun === undefined ? {} : { noun: product.noun }),
    placement: product.placement,
    widthMm: product.sizeMm.widthMm,
    depthMm: product.sizeMm.depthMm,
    heightMm: product.sizeMm.heightMm,
    pieces: 1,
    xMm: Math.max(0, Math.round(spot.xMm)),
    yMm: Math.max(0, Math.round(spot.yMm)),
    elevationMm: 0,
    rotationDeg: spot.rotationDeg,
  };
}

/** "No used rug fits, so here is a new one from target.com for $29.", naming the product when it differs from its need. */
function gapSentence(product: NewProduct, noun: string): string {
  const need = CATEGORY_NOUN[product.category];
  const what = noun.endsWith(need) ? "one" : noun;
  return `No used ${need} fits, so here is a new ${what} from ${product.retailer} for ${usd(product.priceCents)}.`;
}

export function placeNewProduct(context: BuyerContext, input: z.infer<typeof placeNewProductInput>): NewProductOutcome {
  const product = context.newProducts.get(input.productId);
  if (product === undefined) return { result: { placed: false, problems: [`No product ${input.productId} from search_new_products in this run.`] }, events: [] };
  const { room } = context;
  const existing = context.layout.items.find((item) => item.source === "new_product" && item.channel3ProductId === product.productId);
  let layout: PlanLayout;
  let item: LayoutItem;
  const problems: string[] = [];
  if (existing === undefined) {
    item = settle(room, context.layout, newItemFor(product, input, context.layout));
    layout = putItem(context.layout, item);
    problems.push(...hallRuleViolations(context.constraints, ruleListingOf(product), placed(context)).map((violation) => `${context.hallName} rule ${violation.section}. ${violation.summary}`));
    const left = remainingCents(context);
    if (product.priceCents > left) problems.push(`It costs ${usd(product.priceCents)} and ${usd(Math.max(0, left))} of the ${usd(context.budgetCents)} budget is left.`);
  } else {
    const move = moveItem(room, context.layout, existing.key, input);
    layout = move.layout;
    item = move.moved[0];
  }
  problems.push(...checkFit(room, layout, item).problems.map((problem) => problem.message));
  const unique = [...new Set(problems)];
  if (unique.length > 0) {
    return {
      result: { placed: false, problems: unique },
      events: [{ tool: "place_new_product", blocked: true, summary: `Did not place ${product.title}. ${unique.join(" ")}`, detail: { problems: unique.slice(0, 12), note: input.reason } }],
    };
  }
  const where = whereIs(room, layout, item);
  const noun = itemNoun(item);
  const total = planTotalCents(layout, context.catalog, context.negotiations);
  return {
    layout,
    result: { placed: true, itemKey: item.key, where, notInPayPalOrder: true, budgetLeftCents: context.budgetCents - total },
    events: [
      {
        tool: "place_new_product",
        summary: `${existing === undefined ? "Placed" : "Moved"} ${product.title}, new from ${product.retailer} at ${usd(product.priceCents)}, ${where}. The student buys it there, outside the PayPal order.`,
        sentence: existing === undefined ? gapSentence(product, noun) : `Moved the new ${noun} ${where}.`,
        detail: {
          itemKey: item.key,
          priceCents: product.priceCents,
          totalCents: total,
          note: input.reason,
          newProduct: { productId: product.productId, retailer: product.retailer, buyUrl: product.buyUrl },
        },
      },
    ],
  };
}
