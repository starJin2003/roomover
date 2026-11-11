import type { RoomItemData } from "@/components/room/types";
import type { AgentEventDetail } from "@/lib/domain/agent-events";
import type { AgentName, AgentRunKind, AgentRunStatus, NegotiationStatus, OrderStatus, PaymentMode, PlanStatus } from "@/lib/domain/enums";
import type { TimeWindow } from "@/lib/domain/handoff";
import { formatSlot } from "@/lib/domain/handoff-slots";
import type { PlanLayout } from "@/lib/domain/layout";
import type { ConditionGrade, ListingColor } from "@/lib/domain/listing";
import type { OffersLog } from "@/lib/domain/negotiation";
import { newItemLabel, usedSavings, type Savings } from "@/lib/domain/savings";
import { CONDITION_LABEL } from "@/lib/format";

/**
 * What the Furnish screen knows about a plan. The page renders the first
 * snapshot on the server, and the event stream sends a fresh one after every
 * change, followed by each activity line as it is written.
 */

export interface ActivityEventView {
  seq: number;
  runId: string;
  at: string;
  agent: AgentName;
  tool: string;
  summary: string;
  sentence: string | null;
  blocked: boolean;
  detail: AgentEventDetail;
  paypal: { api: string; id: string } | null;
}

export interface RunView {
  id: string;
  kind: AgentRunKind;
  status: AgentRunStatus;
  request: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** The plan's PayPal order as the panel shows it. */
export interface CheckoutView {
  status: OrderStatus;
  paymentMode: PaymentMode;
  totalCents: number;
  sellerCount: number;
  paypalOrderId: string | null;
  authorizationId: string | null;
  captureId: string | null;
}

export interface NegotiationRoundView {
  round: number;
  from: "buyer" | "seller";
  action: "offer" | "counter" | "accept" | "decline";
  priceCents: number | null;
  slot: string | null;
  message: string;
  heldByCode: string | null;
}

/** One negotiation as the Developer view lists it, every offer and counter in order. */
export interface NegotiationView {
  listingIds: string[];
  titles: string[];
  sellerName: string;
  status: NegotiationStatus;
  askingCents: number;
  agreedCents: number | null;
  slot: string | null;
  rounds: NegotiationRoundView[];
}

export interface PlanView {
  id: string;
  status: PlanStatus;
  presetSlug: string;
  roomLabel: string;
  budgetCents: number;
  stylePrompt: string;
  items: RoomItemData[];
  /** Everything in the room against the budget: used items at their agreed or asking prices, and new items. */
  totalCents: number;
  /** The used items, which is what the one PayPal order holds. */
  usedCents: number;
  /** New items the student buys from retailers, outside the PayPal order. */
  newItemsCents: number;
  /** What the used items saved against comparable new products on Channel3. */
  savings: Savings;
  negotiations: NegotiationView[];
  run: RunView | null;
  checkout: CheckoutView | null;
}

/** What the plan bus carries. `handoff` says the plan's handoff changed, and its screen reads the new state. */
export type PlanMessage = { type: "plan"; plan: PlanView } | { type: "event"; event: ActivityEventView } | { type: "handoff" };

/** The listing facts a placed item shows. */
export interface PlanListing {
  id: string;
  title: string;
  conditionGrade: ConditionGrade;
  priceCents: number;
  /** The new price comparable Channel3 products point to, or null until the lookup ran. */
  channel3NewCents: number | null;
  sellerName: string;
  color: string;
  colors: readonly ListingColor[];
}

/** A plan's negotiation for one listing, as stored. */
export interface PlanNegotiation {
  listingId: string;
  status: NegotiationStatus;
  offers: OffersLog;
  agreedPriceCents: number | null;
  agreedSlot: TimeWindow | null;
}

export interface PlanMeta {
  id: string;
  status: PlanStatus;
  presetSlug: string;
  roomLabel: string;
  budgetCents: number;
  stylePrompt: string;
}

function negotiationViews(negotiations: readonly PlanNegotiation[], listings: ReadonlyMap<string, PlanListing>): NegotiationView[] {
  const groups = new Map<string, PlanNegotiation[]>();
  for (const negotiation of negotiations) {
    const bundle = [...negotiation.offers].reverse().find((offer) => offer.bundleListingIds !== undefined)?.bundleListingIds;
    const key = bundle === undefined ? negotiation.listingId : [...bundle].sort().join(",");
    groups.set(key, [...(groups.get(key) ?? []), negotiation]);
  }
  return [...groups.values()].flatMap((group) => {
    const known = group.flatMap((negotiation) => {
      const listing = listings.get(negotiation.listingId);
      return listing === undefined ? [] : [{ negotiation, listing }];
    });
    if (known.length === 0) return [];
    const [first] = known;
    const agreed = known.every(({ negotiation }) => negotiation.agreedPriceCents !== null) ? known.reduce((sum, { negotiation }) => sum + (negotiation.agreedPriceCents ?? 0), 0) : null;
    return [
      {
        listingIds: known.map(({ listing }) => listing.id),
        titles: known.map(({ listing }) => listing.title),
        sellerName: first.listing.sellerName,
        status: first.negotiation.status,
        askingCents: known.reduce((sum, { listing }) => sum + listing.priceCents, 0),
        agreedCents: first.negotiation.status === "agreed" ? agreed : null,
        slot: first.negotiation.status === "agreed" && first.negotiation.agreedSlot !== null ? formatSlot(first.negotiation.agreedSlot) : null,
        rounds: first.negotiation.offers.map((offer) => ({
          round: offer.round,
          from: offer.from,
          action: offer.action,
          priceCents: offer.priceCents ?? null,
          slot: offer.handoffSlot === undefined ? null : formatSlot({ startsAt: new Date(offer.handoffSlot.startsAt), endsAt: new Date(offer.handoffSlot.endsAt) }),
          message: offer.message,
          heldByCode: offer.heldByCode ?? null,
        })),
      },
    ];
  });
}

export function buildPlanView(
  plan: PlanMeta,
  layout: PlanLayout,
  listings: ReadonlyMap<string, PlanListing>,
  run: RunView | null,
  checkout: CheckoutView | null = null,
  negotiations: readonly PlanNegotiation[] = [],
): PlanView {
  const agreed = new Map(negotiations.flatMap((negotiation) => (negotiation.status === "agreed" && negotiation.agreedPriceCents !== null ? [[negotiation.listingId, negotiation] as const] : [])));
  let usedCents = 0;
  let newItemsCents = 0;
  const savingsLines: { listingId: string; paidCents: number; newCents: number | null }[] = [];
  const items = layout.items.flatMap((item): RoomItemData[] => {
    if (item.source === "new_product") {
      newItemsCents += item.priceCents;
      return [
        {
          layout: item,
          title: item.productName,
          condition: newItemLabel(item.retailer),
          priceCents: item.priceCents,
          sellerName: item.retailer,
          color: "neutral",
          colors: [],
          newFrom: { retailer: item.retailer, buyUrl: item.buyUrl },
        },
      ];
    }
    const listing = listings.get(item.listingId);
    if (listing === undefined) return [];
    const deal = agreed.get(item.listingId);
    const priceCents = deal?.agreedPriceCents ?? listing.priceCents;
    usedCents += priceCents;
    savingsLines.push({ listingId: listing.id, paidCents: priceCents, newCents: listing.channel3NewCents });
    return [
      {
        layout: item,
        title: listing.title,
        condition: CONDITION_LABEL[listing.conditionGrade],
        priceCents,
        ...(priceCents < listing.priceCents ? { listPriceCents: listing.priceCents } : {}),
        sellerName: listing.sellerName,
        color: listing.color,
        colors: listing.colors,
        ...(deal?.agreedSlot ? { slotLabel: formatSlot(deal.agreedSlot) } : {}),
      },
    ];
  });
  return {
    ...plan,
    items,
    totalCents: usedCents + newItemsCents,
    usedCents,
    newItemsCents,
    savings: usedSavings(savingsLines),
    negotiations: negotiationViews(negotiations, listings),
    run,
    checkout,
  };
}
