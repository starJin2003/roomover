import { nextUtcMidnight, type LimitDecision } from "@/lib/agents/limits";

/**
 * Channel3 caps for the public demo, apart from the Claude limits. Each live
 * image search costs one credit, and a photo searched before costs nothing
 * because its answer is cached, so only live searches count.
 */
export const CHANNEL3_LIMITS = {
  sessionSearchesPerDay: 12,
  searchesPerDay: 300,
} as const;

export type Channel3Limits = typeof CHANNEL3_LIMITS;

export function decideChannel3Limit(counts: { sessionToday: number; allToday: number }, now: Date, limits: Channel3Limits = CHANNEL3_LIMITS): LimitDecision {
  if (counts.sessionToday >= limits.sessionSearchesPerDay) {
    return {
      allowed: false,
      reason: "session",
      message: `This browser ran ${limits.sessionSearchesPerDay} Channel3 product searches today, the most the demo allows. A sample photo you already tried still works.`,
      retryAt: nextUtcMidnight(now),
    };
  }
  if (counts.allToday >= limits.searchesPerDay) {
    return { allowed: false, reason: "daily", message: "The demo used today's Channel3 searches. They reset at midnight UTC.", retryAt: nextUtcMidnight(now) };
  }
  return { allowed: true };
}
