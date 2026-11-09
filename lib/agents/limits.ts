import type { AgentRunKind } from "@/lib/domain/enums";
import { MAX_TURNS } from "./buyer/loop";

/**
 * Cost guards for the public demo. Runs that replay a recorded conversation
 * spend no Claude calls and do not count.
 */
export const RUN_LIMITS = {
  sessionRunsPerHour: 6,
  clientRunsPerHour: 15,
  claudeCallsPerDay: 800,
} as const;

export type RunLimits = typeof RUN_LIMITS;

const HOUR_MS = 60 * 60 * 1000;

export interface WindowCount {
  count: number;
  /** Start of the oldest run in the last hour, which decides when a slot opens again. */
  oldest: Date | null;
}

export interface LimitCounts {
  session: WindowCount;
  client: WindowCount;
  claudeCallsToday: number;
}

export type LimitReason = "session" | "client" | "daily";

export type LimitDecision = { allowed: true } | { allowed: false; reason: LimitReason; message: string; retryAt: Date };

export function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const slotOpens = (window: WindowCount, now: Date) => new Date((window.oldest ?? now).getTime() + HOUR_MS);

/**
 * Whether a new run may start. A run reserves its worst case of Claude calls
 * against the daily allowance, so a run that starts can always finish.
 */
export function decideLimit(counts: LimitCounts, kind: AgentRunKind, now: Date, limits: RunLimits = RUN_LIMITS): LimitDecision {
  if (counts.session.count >= limits.sessionRunsPerHour) {
    return {
      allowed: false,
      reason: "session",
      message: `This browser started ${limits.sessionRunsPerHour} agent runs in the last hour, the most the demo allows.`,
      retryAt: slotOpens(counts.session, now),
    };
  }
  if (counts.client.count >= limits.clientRunsPerHour) {
    return {
      allowed: false,
      reason: "client",
      message: `Your network started ${limits.clientRunsPerHour} agent runs in the last hour, the most the demo allows.`,
      retryAt: slotOpens(counts.client, now),
    };
  }
  if (counts.claudeCallsToday + MAX_TURNS[kind] > limits.claudeCallsPerDay) {
    return {
      allowed: false,
      reason: "daily",
      message: "The demo used today's allowance of Claude calls. It resets at midnight UTC.",
      retryAt: nextUtcMidnight(now),
    };
  }
  return { allowed: true };
}

export class RunLimitError extends Error {
  constructor(readonly decision: Extract<LimitDecision, { allowed: false }>) {
    super(decision.message);
    this.name = "RunLimitError";
  }
}

/** Another run is already working on the plan. */
export class RunConflictError extends Error {
  constructor() {
    super("The buyer agent is already working on this room.");
    this.name = "RunConflictError";
  }
}

/** Thrown from inside a run when the daily allowance runs out mid run. */
export class RunStopped extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunStopped";
  }
}
