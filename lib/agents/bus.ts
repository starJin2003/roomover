import type { PlanMessage } from "@/lib/plan-view";

/**
 * Hands run updates to the open event streams of the same process. The web
 * service runs one instance, and a stream that misses a message catches up
 * from Postgres when the browser reconnects.
 */

type Listener = (message: PlanMessage) => void;

const store = globalThis as typeof globalThis & { roomoverPlanBus?: Map<string, Set<Listener>> };

function listeners(): Map<string, Set<Listener>> {
  store.roomoverPlanBus ??= new Map();
  return store.roomoverPlanBus;
}

export function publish(planId: string, message: PlanMessage): void {
  for (const listener of listeners().get(planId) ?? []) listener(message);
}

export function subscribe(planId: string, listener: Listener): () => void {
  const map = listeners();
  const set = map.get(planId) ?? new Set<Listener>();
  set.add(listener);
  map.set(planId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) map.delete(planId);
  };
}
