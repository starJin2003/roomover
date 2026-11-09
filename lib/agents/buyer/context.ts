import type { AnswerResult } from "@/lib/agents/seller/negotiate";
import type { OfferFacts } from "@/lib/agents/seller/negotiate-prompt";
import type { NewProduct, NewProductQuery } from "@/lib/channel3/search";
import type { AgentEventDetail } from "@/lib/domain/agent-events";
import type { FitRoom } from "@/lib/domain/fit";
import type { RuleListing } from "@/lib/domain/hall-check";
import type { HallConstraint } from "@/lib/domain/hall-rules";
import type { PlanLayout } from "@/lib/domain/layout";
import type { NegotiationStatus, PaymentMode } from "@/lib/domain/enums";
import type { TimeWindow } from "@/lib/domain/handoff";
import type { ConditionGrade, ListingColor } from "@/lib/domain/listing";
import type { NegotiationState, OffersLog, Terms } from "@/lib/domain/negotiation";
import type { PlaceableListing } from "@/lib/domain/placement";

/** An active listing as the buyer agent sees it, with its seller's name. */
export interface CatalogListing extends RuleListing, PlaceableListing {
  sellerId: string;
  sellerName: string;
  priceCents: number;
  /** The least the seller takes. Code and the seller agent see it, the buyer agent never does. */
  floorPriceCents: number;
  /** A same room listing stays in its room, so only the student moving into that room can buy it. */
  sameRoom: { roomPresetId: string; roomNumber: string } | null;
  /** The generic product the listing compares to for savings. */
  retailProductName: string;
  /** The Channel3 product Sell matched to the listing, when it found one. */
  matchedRetail: { productName: string; newPriceCents: number; url: string | null; retailer: string | null } | null;
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

/** One listing's negotiation as Postgres stores it. A bundle writes one record per listing with the same log. */
export interface NegotiationRecord {
  listingId: string;
  status: NegotiationStatus;
  offers: OffersLog;
  agreedPriceCents: number | null;
  agreedSlot: TimeWindow | null;
}

/** A negotiation in a run, shared by every listing of a bundle. */
export interface LiveNegotiation {
  listingIds: string[];
  state: NegotiationState;
  log: OffersLog;
  /** Each listing's share of an agreed bundle price. Null for a single listing. */
  shares: ReadonlyMap<string, number> | null;
}

/** The seller agents and their record. The run wires them to Claude and Postgres, and tests to fakes. */
export interface NegotiationPort {
  /** Asks the seller agent for one answer. The key names the offer without dates, so recordings replay on any day. */
  answer(key: string, facts: OfferFacts): Promise<AnswerResult & { latencyMs: number }>;
  save(records: NegotiationRecord[]): Promise<void>;
}

export type NewProductSearch =
  | { ok: true; products: NewProduct[]; productCount: number; credits: number; cached: boolean; latencyMs: number; queryKey: string }
  | { ok: false; problem: string };

/** Channel3's catalog as the buyer agent searches it. */
export interface NewProductPort {
  search(query: NewProductQuery): Promise<NewProductSearch>;
}

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
  /** The room the student moves into, which decides who can buy a same room listing. */
  roomPresetId: string;
  roomNumber: string | null;
  /** The student's own move in window, when the plan has one. Every handoff slot sits inside it. */
  buyerWindow: TimeWindow | null;
  /** Negotiations by listing. A bundle's listings share one entry. */
  negotiations: Map<string, LiveNegotiation>;
  /** Listings place_item or check_fit refused for the room itself, which opens Channel3 for their category. */
  fitFailures: Set<string>;
  /** Products search_new_products returned in this run, which place_new_product may use. */
  newProducts: Map<string, NewProduct>;
  /** Absent when the run cannot negotiate, and make_offer says so. */
  negotiator?: NegotiationPort;
  /** Absent when the run cannot reach Channel3, and search_new_products says so. */
  channel3?: NewProductPort;
}

/** One line for the activity panel. `sentence` is the everyday version a student reads. */
export interface EventDraft {
  tool: string;
  /** Set when another agent took the step, such as a seller agent answering an offer. */
  agent?: "seller";
  summary: string;
  sentence?: string;
  blocked?: boolean;
  detail?: AgentEventDetail;
  /** The PayPal API a step called and the sandbox ID it produced. */
  paypal?: { api: string; id: string };
}

export const firstName = (name: string) => name.split(" ")[0];

/** The agreed terms for one listing, with its share of the price when it was agreed in a bundle. */
export function agreementFor(negotiations: ReadonlyMap<string, LiveNegotiation>, listingId: string): Terms | null {
  const negotiation = negotiations.get(listingId);
  const agreed = negotiation?.state.status === "agreed" ? negotiation.state.agreed : null;
  if (negotiation === undefined || agreed === null) return null;
  return { priceCents: negotiation.shares?.get(listingId) ?? agreed.priceCents, slot: agreed.slot };
}

/** What the student pays for a listing: the agreed price when there is one, else the asking price. */
export function priceFor(context: Pick<BuyerContext, "catalog" | "negotiations">, listingId: string): number {
  return agreementFor(context.negotiations, listingId)?.priceCents ?? context.catalog.get(listingId)?.priceCents ?? 0;
}

/** What the items in the layout cost: used items at their agreed or asking prices, and new items at the retailer's price. */
export function planTotalCents(layout: PlanLayout, catalog: ReadonlyMap<string, Pick<CatalogListing, "priceCents">>, negotiations: ReadonlyMap<string, LiveNegotiation> = new Map()): number {
  return layout.items.reduce(
    (sum, item) => sum + (item.source === "listing" ? (agreementFor(negotiations, item.listingId)?.priceCents ?? catalog.get(item.listingId)?.priceCents ?? 0) : item.priceCents),
    0,
  );
}

/** What the same items cost new, for the "less than buying new" line. */
export function planNewCents(layout: PlanLayout, catalog: ReadonlyMap<string, Pick<CatalogListing, "newPriceCents">>): number {
  return layout.items.reduce((sum, item) => sum + (item.source === "listing" ? (catalog.get(item.listingId)?.newPriceCents ?? 0) : item.priceCents), 0);
}
