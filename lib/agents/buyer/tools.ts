import { z } from "zod";
import { LISTING_CATEGORIES, type ListingCategory } from "@/lib/domain/enums";
import { checkFit, doorZone } from "@/lib/domain/fit";
import { bounds, rectangle } from "@/lib/domain/geometry";
import { hallRuleViolations, type RuleViolation } from "@/lib/domain/hall-check";
import { furnitureTypeFor, nounFor } from "@/lib/domain/furniture";
import { footprint, type LayoutItem, type PlanLayout } from "@/lib/domain/layout";
import { layoutItemFor, moveItem, putItem, removeItem, riders, settle, supportFor, type Spot } from "@/lib/domain/placement";
import { QUARTER_TURNS } from "@/lib/domain/room";
import { categoriesFor, needCoverage } from "@/lib/domain/room-needs";
import { itemNoun, whereIs, withArticle } from "@/lib/domain/room-words";
import { formatUsdShort } from "@/lib/format";
import { firstName, planTotalCents, priceFor, type BuyerContext, type CatalogListing, type EventDraft } from "./context";
import { FLOOR_MAP_LEGEND, floorMap } from "./floor-map";
import { cancelNegotiation, handoffForAgent, makeOffer, makeOfferInput, respondToOffer, respondToOfferInput, slotWindow } from "./negotiation";
import { offeredTo, placeNewProduct, placeNewProductInput, searchNewProducts, searchNewProductsInput, usedOptions } from "./new-products";

/**
 * The buyer agent's tools. The model proposes a listing and a spot, an offer,
 * or a new product, and every hard limit (the listing exists, is active, and
 * is offered to this room, the hall rules, the budget, the fit with its
 * egress path, the seller's floor, and the handoff windows) is checked here
 * in code before anything changes. create_checkout takes no input at all, so
 * the order's amounts always come from the listings and the agreed terms.
 */

export interface ToolOutcome {
  /** What the model reads back, serialized as JSON. */
  result: unknown;
  events: EventDraft[];
  /** The plan's layout after the call, when the call changed it. */
  layout?: PlanLayout;
}

export interface BuyerTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: S;
  /** Runs the moment its call streams in, beside other calls, because it waits on another agent and changes no layout. */
  concurrent?: boolean;
  run: (context: BuyerContext, input: z.infer<S>) => ToolOutcome | Promise<ToolOutcome>;
}

const defineTool = <S extends z.ZodType>(tool: BuyerTool<S>): BuyerTool => tool as unknown as BuyerTool;

const listingId = z.uuid().describe("The listingId from search_listings.");
const spot = {
  xMm: z.number().int().min(0).max(20_000).describe("Center of the item's footprint, millimeters east of the west wall."),
  yMm: z.number().int().min(0).max(20_000).describe("Center of the item's footprint, millimeters south of the north wall."),
  rotationDeg: z.literal(QUARTER_TURNS).describe("Clockwise turn seen from above. 0 faces the item's front south, 90 west, 180 north, 270 east."),
};

const usd = formatUsdShort;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The latest day from today the student can collect a listing, or null when no handoff can happen. */
const pickupWithinDays = (context: BuyerContext, listing: CatalogListing) =>
  listing.pickup === null ? null : Math.max(0, Math.ceil((listing.pickup.endsAt.getTime() - context.now.getTime()) / DAY_MS));

function listingOrError(context: BuyerContext, id: string): CatalogListing | string {
  return context.catalog.get(id) ?? `No active listing ${id}. Use a listingId from search_listings.`;
}

function placedListings(context: BuyerContext): CatalogListing[] {
  return context.layout.items.flatMap((item) => {
    const listing = item.source === "listing" ? context.catalog.get(item.listingId) : undefined;
    return listing === undefined ? [] : [listing];
  });
}

function placedItemFor(layout: PlanLayout, id: string): LayoutItem | undefined {
  return layout.items.find((item) => item.source === "listing" && item.listingId === id);
}

const ruleText = (context: BuyerContext, violation: RuleViolation) => `${context.hallName} rule ${violation.section}. ${violation.summary}`;

const sameRoomProblem = (listing: CatalogListing) => `${listing.title} stays in its room for the student moving in there, so this room cannot take it.`;

const nounOf = (listing: CatalogListing) => {
  const furnitureType = furnitureTypeFor(listing);
  return itemNoun({ furnitureType, pieces: listing.specs.pieces ?? 1, ...nounFor(furnitureType, listing.title) });
};

interface Evaluation {
  layout: PlanLayout;
  item: LayoutItem;
  /** True when the listing was already in the plan and this call moves it. */
  moving: boolean;
  problems: string[];
}

/** Runs every hard check for a listing at a spot without changing the plan. */
function evaluate(context: BuyerContext, listing: CatalogListing, target: Spot): Evaluation {
  const { room } = context;
  const existing = placedItemFor(context.layout, listing.id);
  const problems: string[] = [];
  let layout: PlanLayout;
  let moved: LayoutItem[];

  if (existing === undefined) {
    const item = settle(room, context.layout, layoutItemFor(listing, target, context.layout));
    layout = putItem(context.layout, item);
    moved = [item];
    if (!offeredTo(context, listing)) problems.push(sameRoomProblem(listing));
    problems.push(...hallRuleViolations(context.constraints, listing, placedListings(context)).map((violation) => ruleText(context, violation)));
    const total = planTotalCents(context.layout, context.catalog, context.negotiations);
    const price = priceFor(context, listing.id);
    if (total + price > context.budgetCents) {
      problems.push(`It costs ${usd(price)} and ${usd(Math.max(0, context.budgetCents - total))} of the ${usd(context.budgetCents)} budget is left.`);
    }
  } else {
    ({ layout, moved } = moveItem(room, context.layout, existing.key, target));
  }

  const fitProblems = moved.flatMap((item) => checkFit(room, layout, item).problems.map((problem) => problem.message));
  // A listing the room itself refused opens Channel3 for its category, once no other used listing fits.
  if (existing === undefined && fitProblems.length > 0) context.fitFailures.add(listing.id);
  problems.push(...fitProblems);
  const item = moved[0];
  return { layout, item, moving: existing !== undefined, problems: [...new Set(problems)] };
}

function budgetState(context: BuyerContext, layout: PlanLayout = context.layout) {
  const spentCents = planTotalCents(layout, context.catalog, context.negotiations);
  return { budgetCents: context.budgetCents, spentCents, remainingCents: context.budgetCents - spentCents };
}

/** The budget and the room needs no placed item covers yet, which every change reports back. */
function planState(context: BuyerContext, layout: PlanLayout = context.layout) {
  const categories = layout.items.flatMap((item) => {
    if (item.source === "new_product") return [item.category];
    const listing = context.catalog.get(item.listingId);
    return listing === undefined ? [] : [listing.category];
  });
  const needs = needCoverage(categories);
  // Code names the open needs no used listing can cover, so the agent turns to Channel3 for exactly those.
  const forChannel3 = needs.open.flatMap((need) => {
    const categoriesLeft = categoriesFor(need);
    return categoriesLeft.every((category) => usedOptions({ ...context, layout }, category).length === 0) ? [{ need, category: categoriesLeft[0] }] : [];
  });
  return {
    ...budgetState(context, layout),
    needsCovered: needs.covered,
    needsOpen: needs.open,
    ...(forChannel3.length > 0 ? { noUsedListingFor: forChannel3, next: "Fill each of these needs with search_new_products and place_new_product." } : {}),
  };
}

const CATEGORY_WORDS: Readonly<Record<ListingCategory, readonly [string, string]>> = {
  bed_accessory: ["piece of bedding", "pieces of bedding"],
  desk: ["desk", "desks"],
  chair: ["chair", "chairs"],
  shelf: ["bookcase", "bookcases"],
  lamp: ["lamp", "lamps"],
  rug: ["rug", "rugs"],
  mini_fridge: ["mini fridge", "mini fridges"],
  storage: ["storage piece", "storage pieces"],
};

function searchSentence(count: number, category: ListingCategory | undefined, maxPriceCents: number | undefined): string | undefined {
  if (count === 0) return undefined;
  const [one, many] = category === undefined ? ["listing", "listings"] : CATEGORY_WORDS[category];
  const price = maxPriceCents === undefined ? "" : ` up to ${usd(maxPriceCents)}`;
  return `Looking at ${count} ${count === 1 ? one : many}${price}.`;
}

const box = (polygon: ReturnType<typeof footprint>) => {
  const { minX, minY, maxX, maxY } = bounds(polygon);
  return { minX: Math.round(minX), minY: Math.round(minY), maxX: Math.round(maxX), maxY: Math.round(maxY) };
};

function describePlaced(context: BuyerContext, layout: PlanLayout) {
  return layout.items.map((item) => {
    const listing = item.source === "listing" ? context.catalog.get(item.listingId) : undefined;
    return {
      itemKey: item.key,
      listingId: item.source === "listing" ? item.listingId : undefined,
      title: item.source === "new_product" ? `${item.productName}, new from ${item.retailer}` : (listing?.title ?? item.key),
      xMm: item.xMm,
      yMm: item.yMm,
      rotationDeg: item.rotationDeg,
      elevationMm: item.elevationMm,
      box: box(footprint(item)),
      where: whereIs(context.room, layout, item),
    };
  });
}

const searchListings = defineTool({
  name: "search_listings",
  description:
    "Search the used items students on this campus have listed. Returns active listings this room can take that are not yet in the plan, best matches first, with size in millimeters (width, depth, height of one piece), the asking price in cents, the seller's first name, pickupWithinDays (the latest day from today the student can collect the item), the handoff days a slot can use, and any hall rule the item breaks. Items that break a hall rule cannot be placed.",
  input: z.strictObject({
    query: z.string().max(80).optional().describe("Words to match against titles, descriptions, colors, and style tags, such as \"lamp warm light\"."),
    category: z.enum(LISTING_CATEGORIES).optional(),
    maxPriceCents: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(24).optional().describe("How many results to return. Defaults to 12."),
  }),
  run(context, input) {
    const words = (input.query ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
    const inPlan = new Set(placedListings(context).map((listing) => listing.id));
    const scored = [...context.catalog.values()]
      .filter((listing) => !inPlan.has(listing.id) && offeredTo(context, listing))
      .filter((listing) => input.category === undefined || listing.category === input.category)
      .filter((listing) => input.maxPriceCents === undefined || listing.priceCents <= input.maxPriceCents)
      .map((listing) => {
        const text = `${listing.title} ${listing.description} ${listing.color} ${listing.styleTags.join(" ")}`.toLowerCase();
        return { listing, score: words.filter((word) => text.includes(word)).length };
      })
      // With a category, a word that matches nothing only reorders, so "soft seating" still finds the chairs.
      .filter(({ score }) => words.length === 0 || score > 0 || input.category !== undefined)
      .sort((a, b) => b.score - a.score || a.listing.priceCents - b.listing.priceCents)
      .slice(0, input.limit ?? 12);

    const events: EventDraft[] = [];
    const results = scored.map(({ listing }) => {
      const violations = hallRuleViolations(context.constraints, listing, placedListings(context));
      if (violations.length > 0 && !context.announcedSkips.has(listing.id)) {
        context.announcedSkips.add(listing.id);
        const noun = nounOf(listing);
        events.push({
          tool: "search_listings",
          blocked: true,
          summary: `${listing.title} from ${listing.sellerName}. ${ruleText(context, violations[0])}`,
          sentence: `Skipped ${withArticle(noun)} from ${firstName(listing.sellerName)} because of ${context.hallName} rule ${violations[0].section}. ${violations[0].summary}`,
          detail: { listingId: listing.id },
        });
      }
      return {
        listingId: listing.id,
        title: listing.title,
        category: listing.category,
        placement: listing.placement,
        sizeMm: [listing.widthMm, listing.depthMm, listing.heightMm],
        pieces: listing.specs.pieces ?? 1,
        priceCents: listing.priceCents,
        newPriceCents: listing.newPriceCents,
        condition: listing.condition,
        seller: firstName(listing.sellerName),
        pickupWithinDays: pickupWithinDays(context, listing),
        handoff: handoffForAgent(slotWindow(context, [listing])),
        color: listing.color,
        styleTags: listing.styleTags,
        ...(violations.length > 0 ? { breaksHallRule: ruleText(context, violations[0]) } : {}),
      };
    });

    const filters = [
      input.query === undefined ? undefined : `"${input.query}"`,
      input.category,
      input.maxPriceCents === undefined ? undefined : `up to ${usd(input.maxPriceCents)}`,
    ].filter(Boolean);
    events.unshift({
      tool: "search_listings",
      summary: `Searched listings${filters.length > 0 ? ` for ${filters.join(", ")}` : ""} and found ${results.length}.`,
      sentence: searchSentence(results.length, input.category, input.maxPriceCents),
      detail: { count: results.length, listingIds: results.map((result) => result.listingId) },
    });
    const empty = results.length === 0 && input.category !== undefined && usedOptions(context, input.category).length === 0;
    return { result: { results, ...planState(context), ...(empty ? { noUsedListing: `No used listing in ${input.category} fits this room. Use search_new_products for it.` } : {}) }, events };
  },
});

const getRoomPreset = defineTool({
  name: "get_room_preset",
  description:
    "Read the room: its size, doors, windows, the furniture the university provides, a character map of the floor, every item already in the plan with its spot, and the needs still open. Code calls it at the start of every run, so call it again only for a fresh floor map.",
  input: z.strictObject({}),
  run(context) {
    const { room } = context;
    const result = {
      room: context.roomLabel,
      preset: context.presetName,
      widthMm: room.widthMm,
      depthMm: room.depthMm,
      ceilingMm: room.ceilingHeightMm,
      coordinates:
        "Millimeters from the inside corner where the north and west walls meet. x runs east and y runs south. A spot is the center of the item's footprint. At rotation 0 or 180 the item's width runs along x, and at 90 or 270 along y. Elevation is worked out in code from what the item stands on.",
      doors: room.geometry.doors.map((door) => ({
        wall: door.wall,
        fromMm: door.offsetMm,
        toMm: door.offsetMm + door.widthMm,
        swing: door.swing,
        keepClear: box(doorZone(room, door)),
      })),
      windows: room.geometry.windows.map((window) => ({
        wall: window.wall,
        fromMm: window.offsetMm,
        toMm: window.offsetMm + window.widthMm,
        sillMm: window.sillHeightMm,
      })),
      fixtures: room.geometry.fixtures.map((fixture) => ({
        label: fixture.label,
        kind: fixture.kind,
        box: box(rectangle(fixture.xMm, fixture.yMm, fixture.widthMm, fixture.depthMm, fixture.rotationDeg)),
        topMm: fixture.heightMm,
      })),
      egressPathMm: room.egressPathMm,
      floorMap: floorMap(room, context.layout),
      floorMapLegend: FLOOR_MAP_LEGEND,
      placed: describePlaced(context, context.layout),
      ...planState(context),
    };
    const size = `${(room.widthMm / 1000).toFixed(1)} by ${(room.depthMm / 1000).toFixed(1)} meters`;
    const windows = room.geometry.windows.length === 1 ? "1 window" : `${room.geometry.windows.length} windows`;
    return {
      result,
      events: [
        {
          tool: "get_room_preset",
          summary: `Read ${context.roomLabel}, a ${context.presetName} of ${size} with ${room.geometry.doors.length} door and ${windows}.`,
          sentence: `Measuring ${context.roomLabel}, ${size} with ${windows}.`,
        },
      ],
    };
  },
});

const getHallRules = defineTool({
  name: "get_hall_rules",
  description: "List the hall's room standards as code checks them. The full document is in your instructions.",
  input: z.strictObject({}),
  run(context) {
    const rules = context.constraints.map((constraint) => ({ section: constraint.section, rule: constraint.summary }));
    return {
      result: { hall: context.hallName, rules, egressPathMm: context.room.egressPathMm, checkedInCode: true },
      events: [
        {
          tool: "get_hall_rules",
          summary: `Read the ${context.hallName} room standards, ${rules.length} rules that code checks on every placement, including a ${context.room.egressPathMm} mm path from each bed to the door.`,
          sentence: `Reading the ${context.hallName} rules, including the ${context.room.egressPathMm} mm path from each bed to the door.`,
        },
      ],
    };
  },
});

const checkFitTool = defineTool({
  name: "check_fit",
  description:
    "Test a listing at a spot without changing the plan. Runs the same checks as place_item (hall rules, budget, room bounds, overlaps, door swing, windows, heaters, what it stands on, and the path from each bed to the door) and lists every problem.",
  input: z.strictObject({ listingId, ...spot }),
  run(context, input) {
    const listing = listingOrError(context, input.listingId);
    if (typeof listing === "string") return { result: { fits: false, problems: [listing] }, events: [] };
    const evaluation = evaluate(context, listing, input);
    const fits = evaluation.problems.length === 0;
    return {
      result: { fits, elevationMm: evaluation.item.elevationMm, problems: evaluation.problems, ...budgetState(context) },
      events: [
        {
          tool: "check_fit",
          summary: `Checked ${listing.title} at ${input.xMm}, ${input.yMm} mm, turned ${input.rotationDeg} degrees. ${fits ? "It fits." : evaluation.problems.join(" ")}`,
          detail: { listingId: listing.id, ...(fits ? {} : { problems: evaluation.problems.slice(0, 12) }) },
        },
      ],
    };
  },
});

const placeItem = defineTool({
  name: "place_item",
  description:
    "Put a listing in the plan at a spot, or move a listing that is already in the plan. Nothing changes unless every check passes, and the result lists any problems to fix. Write a short reason for the student.",
  input: z.strictObject({
    listingId,
    ...spot,
    reason: z.string().min(1).max(160).describe("One short sentence on why this item and spot suit the student."),
  }),
  run(context, input) {
    const listing = listingOrError(context, input.listingId);
    if (typeof listing === "string") return { result: { placed: false, problems: [listing] }, events: [] };
    const evaluation = evaluate(context, listing, input);
    if (evaluation.problems.length > 0) {
      return {
        result: { placed: false, problems: evaluation.problems, ...budgetState(context) },
        events: [
          {
            tool: "place_item",
            blocked: true,
            summary: `Did not place ${listing.title}. ${evaluation.problems.join(" ")}`,
            detail: { listingId: listing.id, problems: evaluation.problems.slice(0, 12), note: input.reason },
          },
        ],
      };
    }
    const { layout, item, moving } = evaluation;
    context.fitFailures.delete(listing.id);
    const where = whereIs(context.room, layout, item);
    const noun = itemNoun(item);
    const price = priceFor(context, listing.id);
    const state = planState(context, layout);
    const support = supportFor(context.room, { items: layout.items.filter((other) => other.key !== item.key) }, item);
    return {
      layout,
      result: { placed: true, itemKey: item.key, elevationMm: item.elevationMm, standsOn: support?.hostKey ?? "floor", where, ...state },
      events: [
        {
          tool: "place_item",
          summary: `${moving ? "Moved" : "Placed"} ${listing.title} at ${item.xMm}, ${item.yMm} mm, ${where}. Plan total ${usd(state.spentCents)} of ${usd(state.budgetCents)}.`,
          sentence: moving
            ? `Moved the ${noun} ${where}.`
            : `Found ${withArticle(noun)} that fits ${where}. ${usd(price)} from ${firstName(listing.sellerName)}.`,
          detail: { listingId: listing.id, itemKey: item.key, priceCents: price, totalCents: state.spentCents, note: input.reason },
        },
      ],
    };
  },
});

const removeItemTool = defineTool({
  name: "remove_item",
  description: "Take an item, used or new, out of the plan by its itemKey. Items standing on it must be removed or moved first. Removing a used item ends its negotiation, and a bundle's other items go back to their asking prices.",
  input: z.strictObject({
    itemKey: z.string().min(1).describe("The itemKey from get_room_preset or place_item."),
    reason: z.string().min(1).max(160).describe("One short sentence on why it goes."),
  }),
  async run(context, input) {
    const item = context.layout.items.find((candidate) => candidate.key === input.itemKey);
    if (item === undefined) return { result: { removed: false, problems: [`No item ${input.itemKey} in the plan.`] }, events: [] };
    const carried = riders(context.layout, item);
    if (carried.length > 0) {
      const problem = `${carried.map((rider) => rider.key).join(" and ")} stands on ${item.key}. Move or remove it first.`;
      return { result: { removed: false, problems: [problem] }, events: [] };
    }
    const layout = removeItem(context.layout, item.key);
    const listing = item.source === "listing" ? context.catalog.get(item.listingId) : undefined;
    const canceled = item.source === "listing" ? await cancelNegotiation(context, item.listingId) : [];
    const state = planState(context, layout);
    const owner = listing === undefined ? (item.source === "new_product" ? ` from ${item.retailer}` : "") : ` from ${firstName(listing.sellerName)}`;
    const title = item.source === "new_product" ? item.productName : (listing?.title ?? item.key);
    return {
      layout,
      result: { removed: true, ...state },
      events: [
        {
          tool: "remove_item",
          summary: `Removed ${title}. Plan total ${usd(state.spentCents)} of ${usd(state.budgetCents)}.`,
          sentence: `Took the ${item.source === "new_product" ? "new " : ""}${itemNoun(item)}${owner} out of the plan.`,
          detail: { itemKey: item.key, totalCents: state.spentCents, note: input.reason, ...(listing === undefined ? {} : { listingId: listing.id }) },
        },
        ...canceled,
      ],
    };
  },
});

const createCheckout = defineTool({
  name: "create_checkout",
  description:
    "Prepare the one PayPal order the student approves for the used items in the plan. Code reads each price from the listings and the agreed terms, and decides from the handoff slots whether PayPal holds the money until handoff or takes it now, so you pass nothing. New items are bought from their retailers and stay out of the order. Call it once the room is complete and the negotiations have ended, and again after a change that adds or removes a used item. No money moves until the student approves in PayPal.",
  input: z.strictObject({}),
  async run(context) {
    if (context.checkout === undefined) return { result: { prepared: false, problems: ["Checkout is not available in this run."] }, events: [] };
    const outcome = await context.checkout.prepare(context.layout);
    if (!outcome.ok) {
      return {
        result: { prepared: false, problems: [outcome.problem] },
        events: [{ tool: "create_checkout", blocked: true, summary: `Did not prepare the PayPal order. ${outcome.problem}` }],
      };
    }
    const total = usd(outcome.totalCents);
    const students = outcome.sellerCount === 1 ? "1 student" : `${outcome.sellerCount} students`;
    const holds = outcome.paymentMode === "authorize_then_capture";
    return {
      result: {
        prepared: true,
        paypalOrderId: outcome.paypalOrderId,
        totalCents: outcome.totalCents,
        items: outcome.itemCount,
        sellers: outcome.sellerCount,
        payment: holds ? "PayPal holds the money until each handoff." : "PayPal takes the money now, and Roomover holds it until each handoff.",
      },
      events: [
        {
          tool: "create_checkout",
          summary: `${outcome.created ? "Created" : "Kept"} PayPal order ${outcome.paypalOrderId} for ${total}, ${outcome.itemCount} items from ${outcome.sellerCount} sellers, intent ${holds ? "AUTHORIZE" : "CAPTURE"}.`,
          sentence: outcome.created ? `Prepared one PayPal checkout for ${total} from ${students}. It waits for your approval.` : undefined,
          detail: { totalCents: outcome.totalCents, paypalIdKind: "order" },
          paypal: { api: "Orders v2", id: outcome.paypalOrderId },
        },
      ],
    };
  },
});

const makeOfferTool = defineTool({
  name: "make_offer",
  description:
    "Offer a seller's agent a whole dollar price and a two hour handoff slot for one listing, or one price for up to four listings from the same seller as a bundle. The seller agent answers at once: accept, counter, or decline. Code keeps every deal at or above the seller's private floor and inside the handoff windows, and each negotiation ends after 3 rounds. Send offers to different sellers in the same turn so they run at the same time.",
  input: makeOfferInput,
  concurrent: true,
  run: (context, input) => makeOffer(context, input),
});

const respondToOfferTool = defineTool({
  name: "respond_to_offer",
  description: "Accept or decline a seller agent's counter on the listings of the last make_offer. Accepting agrees on the counter's price and slot. Declining leaves the asking price.",
  input: respondToOfferInput,
  run: (context, input) => respondToOffer(context, input),
});

const searchNewProductsTool = defineTool({
  name: "search_new_products",
  description:
    "Search Channel3's catalog of new products for a need no used listing fits. Code refuses while a used listing in that category could still fit the room, the budget, and the rules. Pass the space the spot allows and a price cap, and code keeps new, in stock US products within both. Returns each product's productId, title, retailer, price in cents, and size in millimeters.",
  input: searchNewProductsInput,
  run: (context, input) => searchNewProducts(context, input),
});

const placeNewProductTool = defineTool({
  name: "place_new_product",
  description:
    "Put a product from search_new_products in the room as a new item, or move one already there. Code checks the budget, the hall rules, and the fit the same way as place_item. The student buys a new item from its retailer, so it stays out of the PayPal order.",
  input: placeNewProductInput,
  run: (context, input) => placeNewProduct(context, input),
});

export const BUYER_TOOLS: readonly BuyerTool[] = [
  getRoomPreset,
  getHallRules,
  searchListings,
  checkFitTool,
  placeItem,
  removeItemTool,
  makeOfferTool,
  respondToOfferTool,
  searchNewProductsTool,
  placeNewProductTool,
  createCheckout,
];

export const toolByName = (name: string): BuyerTool | undefined => BUYER_TOOLS.find((tool) => tool.name === name);
