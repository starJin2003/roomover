import { loadPlanView, roomLabel } from "@/lib/agents/buyer/run";
import type { Database } from "@/lib/db/client";
import { ensureHandoffs, loadHandoffOrder } from "@/lib/db/handoffs";
import { latestRun, loadPresetsWithRules, loadSessionPlan, orderEventViews, type PlanRow, type PresetWithRules } from "@/lib/db/plans";
import { canCheck } from "@/lib/domain/order-state";
import type { PlanView } from "@/lib/plan-view";
import { buildHandoffView, type HandoffView, type LayoutRef } from "./view";
import { firstNameOf } from "./words";

export interface HandoffScreenData {
  plan: PlanRow;
  preset: PresetWithRules;
  planView: PlanView;
  view: HandoffView;
}

/** Each listing's place in the room, which names the item and rings it when it is next. */
export function layoutRefs(plan: Pick<PlanRow, "layout">): Map<string, LayoutRef> {
  return new Map(plan.layout.items.flatMap((item, index) => (item.source === "listing" ? [[item.listingId, { key: item.key, furnitureType: item.furnitureType, index }] as const] : [])));
}

export async function presetFor(db: Database, plan: PlanRow): Promise<PresetWithRules | null> {
  return (await loadPresetsWithRules(db)).find((candidate) => candidate.id === plan.roomPresetId) ?? null;
}

/** The handoff state of one plan as it stands now, from the order and its activity. */
export async function loadHandoffView(db: Database, plan: PlanRow, preset: PresetWithRules): Promise<HandoffView | null> {
  let order = await loadHandoffOrder(db, plan.id);
  if (order === null) return null;
  const label = roomLabel(preset, plan.roomNumber);
  if (canCheck(order.status) && (await ensureHandoffs(db, order, label))) order = await loadHandoffOrder(db, plan.id);
  if (order === null) return null;
  return buildHandoffView({ order, roomLabel: label, buyerFirstName: firstNameOf(plan.buyerName), layout: layoutRefs(plan), events: await orderEventViews(db, order.id) });
}

/** Everything the Handoff page renders, only for the session that owns the plan. */
export async function loadHandoffScreen(db: Database, planId: string, sessionId: string): Promise<HandoffScreenData | null> {
  const plan = await loadSessionPlan(db, planId, sessionId);
  if (plan === null) return null;
  const preset = await presetFor(db, plan);
  if (preset === null) return null;
  const [view, planView] = await Promise.all([loadHandoffView(db, plan, preset), latestRun(db, plan.id).then((run) => loadPlanView(db, plan, preset, run))]);
  return view === null ? null : { plan, preset, planView, view };
}
