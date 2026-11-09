import type { NextRequest } from "next/server";
import { z } from "zod";
import { startBuyerRun } from "@/lib/agents/buyer/run";
import { getDb } from "@/lib/db/client";
import { loadPresetsWithRules, loadSessionPlan } from "@/lib/db/plans";
import { CHANGE_REQUEST_MAX_LENGTH } from "@/lib/domain/plan-request";
import { clientHashFrom, jsonResponse, planIdSchema, readBody, runRefusal, sessionFrom } from "@/lib/http";

const bodySchema = z.strictObject({
  request: z.string().trim().min(3, "Say what to change, for example move the bean bag to the window.").max(CHANGE_REQUEST_MAX_LENGTH),
});

/** A change asked for in words. The buyer agent edits the layout through the same tools and checks. */
export async function POST(request: NextRequest, context: RouteContext<"/api/plans/[planId]/requests">): Promise<Response> {
  const { planId } = await context.params;
  const session = sessionFrom(request);
  if (session === null || !planIdSchema.safeParse(planId).success) return jsonResponse(404, { error: "No such plan." });
  const body = await readBody(request, bodySchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const plan = await loadSessionPlan(db, planId, session);
  if (plan === null) return jsonResponse(404, { error: "No such plan." });
  if (plan.layout.items.length === 0) return jsonResponse(409, { error: "Plan the room first, then ask for changes." });
  if (plan.status === "checked_out") return jsonResponse(409, { error: "This room is paid for, so its items stay as they are. You can still move them by hand." });
  const preset = (await loadPresetsWithRules(db)).find((candidate) => candidate.id === plan.roomPresetId);
  if (preset === undefined) return jsonResponse(500, { error: "The plan's room preset is missing." });

  try {
    const run = await startBuyerRun({ plan, preset, kind: "edit", request: body.data.request, sessionId: session, clientHash: clientHashFrom(request) });
    return jsonResponse(202, { runId: run.id });
  } catch (error) {
    const refusal = runRefusal(error);
    if (refusal !== null) return refusal;
    throw error;
  }
}
