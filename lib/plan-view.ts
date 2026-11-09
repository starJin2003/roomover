import type { RoomItemData } from "@/components/room/types";
import type { AgentEventDetail } from "@/lib/domain/agent-events";
import type { AgentName, AgentRunKind, AgentRunStatus, PlanStatus } from "@/lib/domain/enums";
import type { PlanLayout } from "@/lib/domain/layout";
import type { ConditionGrade, ListingColor } from "@/lib/domain/listing";
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

export interface PlanView {
  id: string;
  status: PlanStatus;
  presetSlug: string;
  roomLabel: string;
  budgetCents: number;
  stylePrompt: string;
  items: RoomItemData[];
  totalCents: number;
  /** What the same items cost new. */
  newCents: number;
  run: RunView | null;
}

export type PlanMessage = { type: "plan"; plan: PlanView } | { type: "event"; event: ActivityEventView };

/** The listing facts a placed item shows. */
export interface PlanListing {
  id: string;
  title: string;
  conditionGrade: ConditionGrade;
  priceCents: number;
  newPriceCents: number;
  sellerName: string;
  color: string;
  colors: readonly ListingColor[];
}

export interface PlanMeta {
  id: string;
  status: PlanStatus;
  presetSlug: string;
  roomLabel: string;
  budgetCents: number;
  stylePrompt: string;
}

export function buildPlanView(plan: PlanMeta, layout: PlanLayout, listings: ReadonlyMap<string, PlanListing>, run: RunView | null): PlanView {
  let totalCents = 0;
  let newCents = 0;
  const items = layout.items.flatMap((item): RoomItemData[] => {
    if (item.source !== "listing") return [];
    const listing = listings.get(item.listingId);
    if (listing === undefined) return [];
    totalCents += listing.priceCents;
    newCents += listing.newPriceCents;
    return [
      {
        layout: item,
        title: listing.title,
        condition: CONDITION_LABEL[listing.conditionGrade],
        priceCents: listing.priceCents,
        sellerName: listing.sellerName,
        color: listing.color,
        colors: listing.colors,
      },
    ];
  });
  return { ...plan, items, totalCents, newCents, run };
}
