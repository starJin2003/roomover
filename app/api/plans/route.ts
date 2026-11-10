import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { RECORDED_RUN } from "@/lib/agents/buyer/recorded";
import { roomLabel, startBuyerRun } from "@/lib/agents/buyer/run";
import { RunLimitError } from "@/lib/agents/limits";
import { readConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { createPlan, loadPresetsWithRules, loadSessionPlan, type PresetWithRules } from "@/lib/db/plans";
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
 * words, then starts the buyer agent on it. When the day's Claude allowance
 * or an hourly limit would refuse a live run, the plan becomes Harbor Hall
 * 214 replaying the recorded run, so a judge always sees the agents work and
 * can still pay through PayPal. The first plan from a browser also signs its
 * session cookie.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const body = await readBody(request, bodySchema);
  if (!body.ok) return body.response;
  const reading = readPlanPrompt(body.data.prompt);
  if (!reading.ok) return jsonResponse(422, { error: reading.error, field: "prompt" });

  const db = getDb();
  const presets = await loadPresetsWithRules(db);
  const preset = presets.find((candidate) => candidate.slug === body.data.presetSlug);
  if (preset === undefined) return jsonResponse(422, { error: "Choose one of the rooms listed.", field: "presetSlug" });

  const existing = sessionFrom(request);
  const sessionId = existing ?? newSessionId();
  const clientHash = clientHashFrom(request);

  const start = async (room: PresetWithRules, words: { prompt: string; budgetCents: number }, replay: boolean) => {
    const roomNumber = room.slug === DEMO_ROOM.presetSlug ? DEMO_ROOM.roomNumber : null;
    const planId = await createPlan(db, { buyerId: DEMO_BUYER_ID, sessionId, roomPresetId: room.id, roomNumber, budgetCents: words.budgetCents, stylePrompt: words.prompt });
    const plan = await loadSessionPlan(db, planId, sessionId);
    if (plan === null) throw new Error(`Plan ${planId} vanished after insert.`);
    try {
      const run = await startBuyerRun({ plan, preset: room, kind: "plan", request: null, sessionId, clientHash, replay });
      return { planId, runId: run.id, roomLabel: roomLabel(room, roomNumber), presetSlug: room.slug, stylePrompt: words.prompt, replayed: replay };
    } catch (error) {
      // A plan that never got a run would greet the student as an empty draft, so it goes.
      await db.delete(plans).where(eq(plans.id, planId));
      throw error;
    }
  };

  let started: Awaited<ReturnType<typeof start>>;
  try {
    started = await start(preset, reading, false);
  } catch (error) {
    const recorded = presets.find((candidate) => candidate.slug === RECORDED_RUN.presetSlug);
    const words = readPlanPrompt(RECORDED_RUN.prompt);
    if (!(error instanceof RunLimitError) || recorded === undefined || !words.ok) {
      const refusal = runRefusal(error);
      if (refusal !== null) return refusal;
      throw error;
    }
    started = await start(recorded, words, true);
  }

  const response = NextResponse.json(started, { status: 201, headers: NO_STORE });
  if (existing === null) {
    const { SESSION_SECRET, APP_URL } = readConfig(["SESSION_SECRET", "APP_URL"]);
    response.cookies.set(SESSION_COOKIE, signSession(sessionId, SESSION_SECRET), sessionCookieOptions(APP_URL.startsWith("https://")));
  }
  return response;
}
