import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { publish } from "@/lib/agents/bus";
import { loadPlanView } from "@/lib/agents/buyer/run";
import { getDb } from "@/lib/db/client";
import { latestRun, loadPresetsWithRules, loadSessionPlan, savePlanLayout } from "@/lib/db/plans";
import { agentRuns, plans } from "@/lib/db/schema";
import { EGRESS_PATH_MM } from "@/lib/domain/egress";
import { checkFit, type FitProblem } from "@/lib/domain/fit";
import { planLayoutSchema } from "@/lib/domain/layout";
import { moveItem } from "@/lib/domain/placement";
import { jsonResponse, planIdSchema, readBody, sessionFrom } from "@/lib/http";

const bodySchema = z.strictObject({
  itemKey: z.string().min(1).max(80),
  xMm: z.number().int().min(0).max(20_000),
  yMm: z.number().int().min(0).max(20_000),
  rotationDeg: z.number().int().min(0).max(359),
});

class MoveRejected extends Error {
  constructor(
    readonly status: number,
    readonly body: { error: string; problems?: FitProblem[] },
  ) {
    super(body.error);
  }
}

/**
 * The student's own edit, which moves or turns one item. The same fit
 * check the agent faces runs here, with the hall's egress width, and the
 * layout changes only when everything that moved still fits.
 */
export async function PATCH(request: NextRequest, context: RouteContext<"/api/plans/[planId]/layout">): Promise<Response> {
  const { planId } = await context.params;
  const session = sessionFrom(request);
  if (session === null || !planIdSchema.safeParse(planId).success) return jsonResponse(404, { error: "No such plan." });
  const body = await readBody(request, bodySchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const plan = await loadSessionPlan(db, planId, session);
  if (plan === null) return jsonResponse(404, { error: "No such plan." });
  const preset = (await loadPresetsWithRules(db)).find((candidate) => candidate.id === plan.roomPresetId);
  if (preset === undefined) return jsonResponse(500, { error: "The plan's room preset is missing." });
  const egress = preset.constraints.find((constraint) => constraint.kind === "egress_clearance");
  const room = {
    widthMm: preset.widthMm,
    depthMm: preset.depthMm,
    ceilingHeightMm: preset.ceilingHeightMm,
    geometry: preset.geometry,
    egressPathMm: egress?.kind === "egress_clearance" ? egress.minPathWidthMm : EGRESS_PATH_MM,
  };

  try {
    await db.transaction(async (tx) => {
      const [locked] = await tx.select({ layout: plans.layout }).from(plans).where(eq(plans.id, planId)).for("update");
      const [running] = await tx.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.planId, planId), eq(agentRuns.status, "running")));
      if (running !== undefined) throw new MoveRejected(409, { error: "The buyer agent is working on this room. Move items when it finishes." });
      const layout = planLayoutSchema.parse(locked.layout);
      if (!layout.items.some((item) => item.key === body.data.itemKey)) throw new MoveRejected(404, { error: "That item is no longer in the plan." });
      const move = moveItem(room, layout, body.data.itemKey, body.data);
      const problems = move.moved.flatMap((item) => checkFit(room, move.layout, item).problems);
      if (problems.length > 0) throw new MoveRejected(422, { error: "That spot does not fit.", problems });
      await savePlanLayout(tx, planId, move.layout);
    });
  } catch (error) {
    if (error instanceof MoveRejected) return jsonResponse(error.status, error.body);
    throw error;
  }

  const saved = await loadSessionPlan(db, planId, session);
  if (saved === null) return jsonResponse(404, { error: "No such plan." });
  const view = await loadPlanView(db, saved, preset, await latestRun(db, planId));
  publish(planId, { type: "plan", plan: view });
  return jsonResponse(200, { plan: view });
}
