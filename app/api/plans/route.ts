import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { roomLabel, startBuyerRun } from "@/lib/agents/buyer/run";
import { readConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { createPlan, loadPresetsWithRules, loadSessionPlan } from "@/lib/db/plans";
import { plans } from "@/lib/db/schema";
import { DEMO_BUYER_ID, DEMO_ROOM } from "@/lib/demo";
import { readPlanPrompt } from "@/lib/domain/plan-request";
import { clientHashFrom, jsonResponse, NO_STORE, readBody, runRefusal, sessionFrom } from "@/lib/http";
import { newSessionId, SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";

const bodySchema = z.strictObject({
  presetSlug: z.string().min(1).max(80),
  prompt: z.string().max(2000),
});

/**
 * Creates a plan for the demo buyer from a room preset and the student's own
 * words, then starts the buyer agent on it. The first plan from a browser
 * also signs its session cookie.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const body = await readBody(request, bodySchema);
  if (!body.ok) return body.response;
  const reading = readPlanPrompt(body.data.prompt);
  if (!reading.ok) return jsonResponse(422, { error: reading.error, field: "prompt" });

  const db = getDb();
  const preset = (await loadPresetsWithRules(db)).find((candidate) => candidate.slug === body.data.presetSlug);
  if (preset === undefined) return jsonResponse(422, { error: "Choose one of the rooms listed.", field: "presetSlug" });

  const existing = sessionFrom(request);
  const sessionId = existing ?? newSessionId();
  const roomNumber = preset.slug === DEMO_ROOM.presetSlug ? DEMO_ROOM.roomNumber : null;
  const planId = await createPlan(db, {
    buyerId: DEMO_BUYER_ID,
    sessionId,
    roomPresetId: preset.id,
    roomNumber,
    budgetCents: reading.budgetCents,
    stylePrompt: reading.prompt,
  });
  const plan = await loadSessionPlan(db, planId, sessionId);
  if (plan === null) throw new Error(`Plan ${planId} vanished after insert.`);

  try {
    const run = await startBuyerRun({ plan, preset, kind: "plan", request: null, sessionId, clientHash: clientHashFrom(request) });
    const response = NextResponse.json({ planId, runId: run.id, roomLabel: roomLabel(preset, roomNumber) }, { status: 201, headers: NO_STORE });
    if (existing === null) {
      const { SESSION_SECRET, APP_URL } = readConfig(["SESSION_SECRET", "APP_URL"]);
      response.cookies.set(SESSION_COOKIE, signSession(sessionId, SESSION_SECRET), sessionCookieOptions(APP_URL.startsWith("https://")));
    }
    return response;
  } catch (error) {
    // A plan that never got a run would greet the student as an empty draft, so it goes.
    await db.delete(plans).where(eq(plans.id, planId));
    const refusal = runRefusal(error);
    if (refusal !== null) return refusal;
    throw error;
  }
}
