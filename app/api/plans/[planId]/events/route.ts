import type { NextRequest } from "next/server";
import { subscribe } from "@/lib/agents/bus";
import { loadPlanView } from "@/lib/agents/buyer/run";
import { getDb } from "@/lib/db/client";
import { eventsAfter, latestRun, loadPresetsWithRules, loadSessionPlan } from "@/lib/db/plans";
import { jsonResponse, planIdSchema, sessionFrom } from "@/lib/http";
import type { PlanMessage, PlanView } from "@/lib/plan-view";
import { formatSse, formatSseComment, lastEventId } from "@/lib/sse";

const HEARTBEAT_MS = 15_000;
const RECONNECT_MS = 2_000;

/**
 * The live activity for one plan as server sent events. A connection gets
 * the plan as it stands, every activity line after the last one it saw,
 * and then each update as the run writes it.
 */
export async function GET(request: NextRequest, context: RouteContext<"/api/plans/[planId]/events">): Promise<Response> {
  const { planId } = await context.params;
  const session = sessionFrom(request);
  if (session === null || !planIdSchema.safeParse(planId).success) return jsonResponse(404, { error: "No such plan." });

  const db = getDb();
  const plan = await loadSessionPlan(db, planId, session);
  if (plan === null) return jsonResponse(404, { error: "No such plan." });
  const preset = (await loadPresetsWithRules(db)).find((candidate) => candidate.id === plan.roomPresetId);
  if (preset === undefined) return jsonResponse(500, { error: "The plan's room preset is missing." });

  const freshView = async (): Promise<PlanView> => {
    const latest = await loadSessionPlan(db, planId, session);
    return loadPlanView(db, latest ?? plan, preset, await latestRun(db, planId));
  };
  let lastSeq = Math.max(lastEventId(request.headers), Number(request.nextUrl.searchParams.get("after")) || 0);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          open = false;
        }
      };
      const deliver = (message: PlanMessage) => {
        if (message.type === "plan") {
          send(formatSse({ event: "plan", data: message.plan }));
        } else if (message.type === "event" && message.event.seq > lastSeq) {
          lastSeq = message.event.seq;
          send(formatSse({ id: lastSeq, event: "activity", data: message.event }));
        }
      };

      // Subscribe before reading Postgres, so nothing written in between is lost.
      const waiting: PlanMessage[] = [];
      let live = false;
      const unsubscribe = subscribe(planId, (message) => (live ? deliver(message) : waiting.push(message)));
      const heartbeat = setInterval(() => send(formatSseComment("ping")), HEARTBEAT_MS);
      const close = () => {
        open = false;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // The stream already closed on the client's side.
        }
      };
      request.signal.addEventListener("abort", close);

      try {
        send(formatSse({ event: "plan", data: await freshView(), retry: RECONNECT_MS }));
        for (const event of await eventsAfter(db, planId, lastSeq)) deliver({ type: "event", event });
        live = true;
        for (const message of waiting) if (message.type === "event") deliver(message);
        // A snapshot published while this stream was catching up may be older than the one sent, so send the current one.
        if (waiting.some((message) => message.type === "plan")) send(formatSse({ event: "plan", data: await freshView() }));
      } catch (error) {
        console.error("plan event stream failed", { planId, error: error instanceof Error ? error.name : "unknown" });
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
