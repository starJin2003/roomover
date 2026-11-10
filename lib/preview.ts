import { loadPlanView } from "@/lib/agents/buyer/run";
import { failure, type CheckoutFailure } from "@/lib/checkout/approve";
import type { Database } from "@/lib/db/client";
import { eventsAfter, latestRun, loadPresetsWithRules, loadSharedPlan } from "@/lib/db/plans";
import { assistantName } from "@/lib/domain/mcp";
import type { ActivityEventView, PlanView } from "@/lib/plan-view";

/**
 * The page behind a preview link: a plan an outside assistant made over
 * MCP, which the student looks at and approves in PayPal. Only plans an MCP
 * session made open this way, so a link never shows a browser's own room.
 * Once a browser approves, the plan is its own, and every other visit reads
 * the held payment without changing anything.
 */

export interface PreviewData {
  plan: PlanView;
  events: ActivityEventView[];
  /** Who planned the room, such as Claude, from the name the MCP client gave. */
  assistant: string;
  buyerFirstName: string;
  /** The session that holds the plan now, which is the approving browser's once it claimed the plan. Never sent to the page. */
  ownerSessionId: string | null;
  claimed: boolean;
}

export type PreviewNotice = { tone: "info" | "error"; text: string };

const FAILURES: readonly CheckoutFailure[] = ["not_found", "declined", "expired", "not_approved", "taken", "failed"];

/** The sentence for the ?paypal= value PayPal's cancel URL or the return route adds. */
export function previewNotice(code: string | undefined): PreviewNotice | null {
  if (code === "canceled") return { tone: "info", text: "You left PayPal before approving, so nothing was charged. Press PayPal when you are ready." };
  const known = FAILURES.find((candidate) => candidate === code);
  return known === undefined ? null : { tone: "error", text: failure(known).message };
}

/** The assistant that asked, read from the plan's first MCP line. */
export function plannerOf(events: readonly ActivityEventView[]): string {
  const mcp = events.find((event) => event.detail.mcp !== undefined)?.detail.mcp;
  return assistantName(mcp?.client, mcp?.fromAnthropic);
}

export async function loadPreview(db: Database, planId: string): Promise<PreviewData | null> {
  const row = await loadSharedPlan(db, planId);
  if (row === null) return null;
  const preset = (await loadPresetsWithRules(db)).find((candidate) => candidate.id === row.roomPresetId);
  if (preset === undefined) return null;
  const [plan, events] = await Promise.all([latestRun(db, planId).then((run) => loadPlanView(db, row, preset, run)), eventsAfter(db, planId, 0)]);
  return { plan, events, assistant: plannerOf(events), buyerFirstName: row.buyerName.split(" ")[0], ownerSessionId: row.sessionId, claimed: row.claimedAt !== null };
}
