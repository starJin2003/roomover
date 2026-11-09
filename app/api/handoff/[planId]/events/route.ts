import type { NextRequest } from "next/server";
import { subscribe } from "@/lib/agents/bus";
import { handoffRequest } from "@/lib/handoff/http";
import { loadHandoffView } from "@/lib/handoff/load";
import { refreshPayout } from "@/lib/handoff/payouts";
import type { HandoffView } from "@/lib/handoff/view";
import { paypalRest } from "@/lib/paypal/rest/client";
import { formatSse, formatSseComment } from "@/lib/sse";

const HEARTBEAT_MS = 15_000;
const RECONNECT_MS = 2_000;
/** Changes that arrive together become one snapshot, read after the writing transaction commits. */
const SETTLE_MS = 250;
const PAYOUT_POLL_MS = 2_500;
/** A batch that has not landed in 10 minutes is left to the webhooks. */
const PAYOUT_POLL_FOR_MS = 10 * 60 * 1000;

/**
 * The handoff as server sent events. Every change on the plan's bus sends a
 * fresh snapshot. While a payout batch is still landing, the stream also
 * reads the batch back from PayPal, so seller rows fill even where the
 * webhooks go to another deployment.
 */
export async function GET(request: NextRequest, context: RouteContext<"/api/handoff/[planId]/events">): Promise<Response> {
  const handoff = await handoffRequest(request, (await context.params).planId);
  if (handoff instanceof Response) return handoff;
  const { db, plan, preset } = handoff;
  const encoder = new TextEncoder();
  const opened = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let polling = false;
      // The latest snapshot says whether a payout is still landing, so the stream reads PayPal only then.
      let waitingOrder: string | null = null;
      const send = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          open = false;
        }
      };
      const snapshot = async (retry?: number): Promise<HandoffView | null> => {
        const view = await loadHandoffView(db, plan, preset);
        waitingOrder = view?.payout?.waiting === true ? view.orderId : null;
        if (view !== null) send(formatSse({ event: "handoff", data: view, retry }));
        return view;
      };
      const soon = () => {
        clearTimeout(timer);
        timer = setTimeout(() => void snapshot().catch(() => undefined), SETTLE_MS);
      };
      const unsubscribe = subscribe(plan.id, soon);
      const heartbeat = setInterval(() => send(formatSseComment("ping")), HEARTBEAT_MS);
      const poll = setInterval(async () => {
        if (polling || waitingOrder === null || Date.now() - opened > PAYOUT_POLL_FOR_MS) return;
        polling = true;
        try {
          await refreshPayout({ db, rest: paypalRest(), now: () => new Date() }, waitingOrder);
        } catch (error) {
          console.error("handoff payout read failed", { planId: plan.id, error: error instanceof Error ? error.name : "unknown" });
        } finally {
          polling = false;
        }
      }, PAYOUT_POLL_MS);
      const close = () => {
        open = false;
        clearTimeout(timer);
        clearInterval(heartbeat);
        clearInterval(poll);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // The client already closed its side.
        }
      };
      request.signal.addEventListener("abort", close);
      try {
        await snapshot(RECONNECT_MS);
      } catch (error) {
        console.error("handoff stream failed", { planId: plan.id, error: error instanceof Error ? error.name : "unknown" });
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
