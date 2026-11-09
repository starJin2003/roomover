import { z } from "zod";
import { LISTING_CATEGORIES } from "@/lib/domain/enums";
import { checkFit, doorZone } from "@/lib/domain/fit";
import { bounds, rectangle } from "@/lib/domain/geometry";
import { hallRuleViolations, type RuleViolation } from "@/lib/domain/hall-check";
import { furnitureTypeFor } from "@/lib/domain/furniture";
import { footprint, type LayoutItem, type PlanLayout } from "@/lib/domain/layout";
import { layoutItemFor, moveItem, putItem, removeItem, riders, settle, supportFor, type Spot } from "@/lib/domain/placement";
import { QUARTER_TURNS } from "@/lib/domain/room";
import { itemNoun, whereIs, withArticle } from "@/lib/domain/room-words";
import { formatUsdShort } from "@/lib/format";
import { firstName, planTotalCents, type BuyerContext, type CatalogListing, type EventDraft } from "./context";
import { FLOOR_MAP_LEGEND, floorMap } from "./floor-map";

/**
 * The buyer agent's tools. The model proposes a listing and a spot, and every
 * hard limit (the listing exists and is active, the hall rules, the budget,
 * and the fit with its egress path) is checked here in code before anything
 * changes. Negotiation (`make_offer`) and Channel3 gap filling
 * (`search_new_products`) join this list as further specs.
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
  run: (context: BuyerContext, input: z.infer<S>) => ToolOutcome;
}

const defineTool = <S extends z.ZodType>(tool: BuyerTool<S>): BuyerTool => tool as unknown as BuyerTool;

const listingId = z.uuid().describe("The listingId from search_listings.");
const spot = {
  xMm: z.number().int().min(0).max(20_000).describe("Center of the item's footprint, millimeters east of the west wall."),
  yMm: z.number().int().min(0).max(20_000).describe("Center of the item's footprint, millimeters south of the north wall."),
  rotationDeg: z.literal(QUARTER_TURNS).describe("Clockwise turn seen from above. 0 faces the item's front south, 90 west, 180 north, 270 east."),
};

const usd = formatUsdShort;

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
    problems.push(...hallRuleViolations(context.constraints, listing, placedListings(context)).map((violation) => ruleText(context, violation)));
    const total = planTotalCents(context.layout, context.catalog);
    if (total + listing.priceCents > context.budgetCents) {
      problems.push(`It costs ${usd(listing.priceCents)} and ${usd(Math.max(0, context.budgetCents - total))} of the ${usd(context.budgetCents)} budget is left.`);
    }
  } else {
    ({ layout, moved } = moveItem(room, context.layout, existing.key, target));
  }

  for (const item of moved) {
    for (const problem of checkFit(room, layout, item).problems) problems.push(problem.message);
  }
  const item = moved[0];
  return { layout, item, moving: existing !== undefined, problems: [...new Set(problems)] };
}

function budgetState(context: BuyerContext, layout: PlanLayout = context.layout) {
  const spentCents = planTotalCents(layout, context.catalog);
  return { budgetCents: context.budgetCents, spentCents, remainingCents: context.budgetCents - spentCents };
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
      title: listing?.title ?? (item.source === "new_product" ? item.productName : item.key),
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
    "Search the used items students on this campus have listed. Returns active listings not yet in the plan, best matches first, with size in millimeters (width, depth, height of one piece), price in cents, the seller's first name, and any hall rule the item breaks. Items that break a hall rule cannot be placed.",
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
      .filter((listing) => !inPlan.has(listing.id))
      .filter((listing) => input.category === undefined || listing.category === input.category)
      .filter((listing) => input.maxPriceCents === undefined || listing.priceCents <= input.maxPriceCents)
      .map((listing) => {
        const text = `${listing.title} ${listing.description} ${listing.color} ${listing.styleTags.join(" ")}`.toLowerCase();
        return { listing, score: words.filter((word) => text.includes(word)).length };
      })
      .filter(({ score }) => words.length === 0 || score > 0)
      .sort((a, b) => b.score - a.score || a.listing.priceCents - b.listing.priceCents)
      .slice(0, input.limit ?? 12);

    const events: EventDraft[] = [];
    const results = scored.map(({ listing }) => {
      const violations = hallRuleViolations(context.constraints, listing, placedListings(context));
      if (violations.length > 0 && !context.announcedSkips.has(listing.id)) {
        context.announcedSkips.add(listing.id);
        const noun = itemNoun({ furnitureType: furnitureTypeFor(listing), pieces: listing.specs.pieces ?? 1 });
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
      detail: { count: results.length },
    });
    return { result: { results, ...budgetState(context) }, events };
  },
});

const getRoomPreset = defineTool({
  name: "get_room_preset",
  description:
    "Read the room: its size, doors, windows, the furniture the university provides, a character map of the floor, and every item already in the plan with its spot. Call it before placing anything.",
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
      ...budgetState(context),
    };
    const size = `${(room.widthMm / 1000).toFixed(1)} by ${(room.depthMm / 1000).toFixed(1)} meters`;
    return {
      result,
      events: [
        {
          tool: "get_room_preset",
          summary: `Read ${context.roomLabel}, a ${context.presetName} of ${size} with ${room.geometry.doors.length} door and ${room.geometry.windows.length} windows.`,
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
    const where = whereIs(context.room, layout, item);
    const noun = itemNoun(item);
    const state = budgetState(context, layout);
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
            : `Found ${withArticle(noun)} that fits ${where}. ${usd(listing.priceCents)} from ${firstName(listing.sellerName)}.`,
          detail: { listingId: listing.id, itemKey: item.key, priceCents: listing.priceCents, totalCents: state.spentCents, note: input.reason },
        },
      ],
    };
  },
});

const removeItemTool = defineTool({
  name: "remove_item",
  description: "Take an item out of the plan by its itemKey. Items standing on it must be removed or moved first.",
  input: z.strictObject({
    itemKey: z.string().min(1).describe("The itemKey from get_room_preset or place_item."),
    reason: z.string().min(1).max(160).describe("One short sentence on why it goes."),
  }),
  run(context, input) {
    const item = context.layout.items.find((candidate) => candidate.key === input.itemKey);
    if (item === undefined) return { result: { removed: false, problems: [`No item ${input.itemKey} in the plan.`] }, events: [] };
    const carried = riders(context.layout, item);
    if (carried.length > 0) {
      const problem = `${carried.map((rider) => rider.key).join(" and ")} stands on ${item.key}. Move or remove it first.`;
      return { result: { removed: false, problems: [problem] }, events: [] };
    }
    const layout = removeItem(context.layout, item.key);
    const listing = item.source === "listing" ? context.catalog.get(item.listingId) : undefined;
    const state = budgetState(context, layout);
    const owner = listing === undefined ? "" : ` from ${firstName(listing.sellerName)}`;
    return {
      layout,
      result: { removed: true, ...state },
      events: [
        {
          tool: "remove_item",
          summary: `Removed ${listing?.title ?? item.key}. Plan total ${usd(state.spentCents)} of ${usd(state.budgetCents)}.`,
          sentence: `Took the ${itemNoun(item)}${owner} out of the plan.`,
          detail: { itemKey: item.key, totalCents: state.spentCents, note: input.reason, ...(listing === undefined ? {} : { listingId: listing.id }) },
        },
      ],
    };
  },
});

export const BUYER_TOOLS: readonly BuyerTool[] = [getRoomPreset, getHallRules, searchListings, checkFitTool, placeItem, removeItemTool];

export const toolByName = (name: string): BuyerTool | undefined => BUYER_TOOLS.find((tool) => tool.name === name);
