import type { NextRequest } from "next/server";
import { RunLimitError } from "@/lib/agents/limits";
import { getDb, type Database } from "@/lib/db/client";
import { loadSessionPlan, type PlanRow, type PresetWithRules } from "@/lib/db/plans";
import { jsonResponse, planIdSchema, runRefusal, sessionFrom } from "@/lib/http";
import { HandoffRefused } from "./check";
import { loadHandoffView, presetFor } from "./load";
import { SettlementStopped } from "./settle";

export interface HandoffRequest {
  db: Database;
  sessionId: string;
  plan: PlanRow;
  preset: PresetWithRules;
}

const NOT_FOUND = () => jsonResponse(404, { error: "No such plan." });

/** The plan behind a handoff request, only for the session that owns it. */
export async function handoffRequest(request: NextRequest, planId: string): Promise<HandoffRequest | Response> {
  const sessionId = sessionFrom(request);
  if (sessionId === null || !planIdSchema.safeParse(planId).success) return NOT_FOUND();
  const db = getDb();
  const plan = await loadSessionPlan(db, planId, sessionId);
  if (plan === null) return NOT_FOUND();
  const preset = await presetFor(db, plan);
  if (preset === null) return jsonResponse(500, { error: "The plan's room preset is missing." });
  return { db, sessionId, plan, preset };
}

/** Answers with the handoff as it stands after a step. */
export async function viewResponse(context: HandoffRequest, status = 200): Promise<Response> {
  const view = await loadHandoffView(context.db, context.plan, context.preset);
  return view === null ? jsonResponse(404, { error: "This room has no paid order to hand off." }) : jsonResponse(status, { view });
}

/** Turns a refused or stopped step into its answer, with the sentence the student sees. */
export async function handoffFailure(context: HandoffRequest, error: unknown): Promise<Response> {
  if (error instanceof HandoffRefused) return jsonResponse(error.status, { error: error.message });
  if (error instanceof RunLimitError) return runRefusal(error) as Response;
  if (error instanceof SettlementStopped) {
    const view = await loadHandoffView(context.db, context.plan, context.preset);
    return jsonResponse(502, { error: error.message, view });
  }
  throw error;
}
