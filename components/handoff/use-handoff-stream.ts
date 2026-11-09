"use client";

import { useEffect, useRef } from "react";
import type { HandoffView } from "@/lib/handoff/view";

/**
 * Follows a plan's handoff. Each message is the whole handoff as it stands,
 * so a reconnect needs no catching up.
 */
export function useHandoffStream(planId: string, onView: (view: HandoffView) => void): void {
  const handler = useRef(onView);
  useEffect(() => {
    handler.current = onView;
  });
  useEffect(() => {
    const source = new EventSource(`/api/handoff/${planId}/events`);
    source.addEventListener("handoff", (message) => handler.current(JSON.parse((message as MessageEvent<string>).data) as HandoffView));
    return () => source.close();
  }, [planId]);
}
