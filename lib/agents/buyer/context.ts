import type { AgentEventDetail } from "@/lib/domain/agent-events";
import type { FitRoom } from "@/lib/domain/fit";
import type { RuleListing } from "@/lib/domain/hall-check";
import type { HallConstraint } from "@/lib/domain/hall-rules";
import type { PlanLayout } from "@/lib/domain/layout";
import type { ConditionGrade, ListingColor } from "@/lib/domain/listing";
import type { PlaceableListing } from "@/lib/domain/placement";

/** An active listing as the buyer agent sees it, with its seller's name. */
export interface CatalogListing extends RuleListing, PlaceableListing {
  sellerName: string;
  priceCents: number;
  newPriceCents: number;
  condition: ConditionGrade;
  color: string;
  colors: ListingColor[];
  styleTags: string[];
}

/**
 * Everything one run works with. Tool handlers read it and replace `layout`
 * when they change the plan, and the run persists each new layout.
 */
export interface BuyerContext {
  hallName: string;
  /** Names the room for the student, such as Harbor Hall 214. */
  roomLabel: string;
  presetName: string;
  room: FitRoom & { egressPathMm: number };
  ruleText: string;
  constraints: HallConstraint[];
  budgetCents: number;
  buyerName: string;
  stylePrompt: string;
  catalog: ReadonlyMap<string, CatalogListing>;
  layout: PlanLayout;
  /** Listings already announced as breaking a hall rule, so each is skipped out loud once. */
  announcedSkips: Set<string>;
}

/** One line for the activity panel. `sentence` is the everyday version a student reads. */
export interface EventDraft {
  tool: string;
  summary: string;
  sentence?: string;
  blocked?: boolean;
  detail?: AgentEventDetail;
}

export const firstName = (name: string) => name.split(" ")[0];

/** What the listings in the layout cost at their listed prices. */
export function planTotalCents(layout: PlanLayout, catalog: ReadonlyMap<string, Pick<CatalogListing, "priceCents">>): number {
  return layout.items.reduce((sum, item) => sum + (item.source === "listing" ? (catalog.get(item.listingId)?.priceCents ?? 0) : item.priceCents), 0);
}

/** What the same items cost new, for the "less than buying new" line. */
export function planNewCents(layout: PlanLayout, catalog: ReadonlyMap<string, Pick<CatalogListing, "newPriceCents">>): number {
  return layout.items.reduce((sum, item) => sum + (item.source === "listing" ? (catalog.get(item.listingId)?.newPriceCents ?? 0) : item.priceCents), 0);
}
