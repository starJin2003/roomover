import type { ListingCategory, Placement } from "./enums";
import type { HallConstraint } from "./hall-rules";
import type { ListingSpecs } from "./listing";

/**
 * The hall rules check behind the buyer agent's `place_item` tool. It reads
 * a listing's category, placement, size, and specs against the hall's
 * machine readable constraints. The egress path rule lives in the fit check,
 * because it depends on where things stand.
 */

export interface RuleListing {
  id: string;
  title: string;
  description: string;
  category: ListingCategory;
  placement: Placement;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  specs: ListingSpecs;
}

export interface RuleViolation {
  ruleId: string;
  section: string;
  /** The rule in the hall's words, such as "Halogen lamps and bulbs are prohibited." */
  summary: string;
}

function matchesProhibition(listing: RuleListing, match: Extract<HallConstraint, { kind: "prohibited_item" }>["match"]): boolean {
  const text = `${listing.title} ${listing.description}`.toLowerCase();
  const checks = [
    match.categories === undefined || match.categories.includes(listing.category),
    match.bulbTypes === undefined || (listing.specs.bulbType !== undefined && match.bulbTypes.includes(listing.specs.bulbType)),
    match.keywords === undefined || match.keywords.some((keyword) => text.includes(keyword.toLowerCase())),
  ];
  return checks.every(Boolean);
}

function breaksLimit(
  listing: RuleListing,
  limit: Extract<HallConstraint, { kind: "category_limit" }>,
  placed: readonly RuleListing[],
): boolean {
  if (listing.category !== limit.category) return false;
  const over = (value: number | undefined, max: number | undefined) => value !== undefined && max !== undefined && value > max;
  const count = placed.filter((other) => other.category === limit.category && other.id !== listing.id).length + 1;
  return (
    over(listing.widthMm, limit.maxWidthMm) ||
    over(listing.depthMm, limit.maxDepthMm) ||
    over(listing.heightMm, limit.maxHeightMm) ||
    over(listing.specs.capacityLiters, limit.maxCapacityLiters) ||
    over(listing.specs.watts, limit.maxWatts) ||
    over(count, limit.maxPerResident)
  );
}

/** Every hall rule the listing breaks, given the listings already in the plan. */
export function hallRuleViolations(constraints: readonly HallConstraint[], listing: RuleListing, placed: readonly RuleListing[]): RuleViolation[] {
  return constraints
    .filter((constraint) => {
      switch (constraint.kind) {
        case "prohibited_item":
          return matchesProhibition(listing, constraint.match);
        case "category_limit":
          return breaksLimit(listing, constraint, placed);
        case "bed_lofting":
          return listing.specs.liftHeightMm !== undefined && listing.specs.liftHeightMm > constraint.maxRiserLiftMm;
        case "wall_mounting":
          return listing.placement === "wall" && !constraint.fastenersAllowed;
        case "egress_clearance":
          return false;
      }
    })
    .map((constraint) => ({ ruleId: constraint.id, section: constraint.section, summary: constraint.summary }));
}
