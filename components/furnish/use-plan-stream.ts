"use client";

import { useEffect, useRef, useState } from "react";
import type { ActivityEventView, PlanView } from "@/lib/plan-view";

export type StreamState = "idle" | "open" | "reconnecting";

/**
 * Follows a plan's event stream. The browser's EventSource reconnects on its
 * own and sends the last event ID it saw, so the server fills any gap.
 */
export function usePlanStream(
  planId: string | null,
  afterSeq: number,
  onPlan: (plan: PlanView) => void,
  onEvent: (event: ActivityEventView) => void,
): StreamState {
  const [state, setState] = useState<StreamState>("idle");
  const handlers = useRef({ onPlan, onEvent });
  const after = useRef(afterSeq);
  useEffect(() => {
    handlers.current = { onPlan, onEvent };
    after.current = Math.max(after.current, afterSeq);
  });

  useEffect(() => {
    if (planId === null) return;
    const source = new EventSource(`/api/plans/${planId}/events?after=${after.current}`);
    source.addEventListener("open", () => setState("open"));
    source.addEventListener("error", () => setState(source.readyState === EventSource.CLOSED ? "idle" : "reconnecting"));
    source.addEventListener("plan", (message) => handlers.current.onPlan(JSON.parse((message as MessageEvent<string>).data) as PlanView));
    source.addEventListener("activity", (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as ActivityEventView;
      after.current = Math.max(after.current, event.seq);
      handlers.current.onEvent(event);
    });
    return () => {
      source.close();
      setState("idle");
    };
  }, [planId]);

  return state;
}
