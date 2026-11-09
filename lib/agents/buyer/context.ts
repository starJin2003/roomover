import type { AgentEventDetail } from "@/lib/domain/agent-events";
import type { FitRoom } from "@/lib/domain/fit";
import type { RuleListing } from "@/lib/domain/hall-check";
import type { HallConstraint } from "@/lib/domain/hall-rules";
import type { PlanLayout } from "@/lib/domain/layout";
import type { PaymentMode } from "@/lib/domain/enums";
import type { TimeWindow } from "@/lib/domain/handoff";
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
  /** When the buyer can collect the item, from its handoff mode and windows. Null when they cannot. */
  pickup: TimeWindow | null;
}

export type CheckoutOutcome =
  | { ok: true; created: boolean; paypalOrderId: string; totalCents: number; itemCount: number; sellerCount: number; paymentMode: PaymentMode }
  | { ok: false; problem: string };

/** Prepares the plan's PayPal order. The run wires it to Postgres and the Server SDK, and tests to a fake. */
export interface CheckoutPort {
  prepare(layout: PlanLayout): Promise<CheckoutOutcome>;
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
  /** Absent when the run cannot reach checkout, and create_checkout says so. */
  checkout?: CheckoutPort;
  /** The run's clock, which pickup days count from. */
  now: Date;
}

/** One line for the activity panel. `sentence` is the everyday version a student reads. */
export interface EventDraft {
  tool: string;
  summary: string;
  sentence?: string;
  blocked?: boolean;
  detail?: AgentEventDetail;
  /** The PayPal API a step called and the sandbox ID it produced. */
  paypal?: { api: string; id: string };
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
