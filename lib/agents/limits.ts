import type { AgentRunKind } from "@/lib/domain/enums";
import { MCP_LIMITS } from "@/lib/domain/mcp";
import { MAX_TURNS } from "./buyer/loop";

/**
 * Cost guards for the public demo. Runs that replay a recorded conversation
 * spend no Claude calls and do not count.
 */
export const RUN_LIMITS = {
  sessionRunsPerHour: 6,
  clientRunsPerHour: 15,
  claudeCallsPerDay: 400,
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

export type LimitReason = "session" | "client" | "daily" | "mcp_hour" | "mcp_daily";

export type LimitDecision = { allowed: true } | { allowed: false; reason: LimitReason; message: string; retryAt: Date };

export function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const slotOpens = (window: WindowCount, now: Date) => new Date((window.oldest ?? now).getTime() + HOUR_MS);

/** A Sell run is one seller agent call and its one retry. */
export const SELL_RUN_CALLS = 2;

/**
 * Whether a new run may start. Buyer runs and Sell runs share these limits.
 * A run reserves its worst case of Claude calls against the daily
 * allowance, so a run that starts can always finish.
 */
export function decideLimit(counts: LimitCounts, kind: AgentRunKind | "sell", now: Date, limits: RunLimits = RUN_LIMITS): LimitDecision {
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
  if (counts.claudeCallsToday + (kind === "sell" ? SELL_RUN_CALLS : MAX_TURNS[kind]) > limits.claudeCallsPerDay) {
    return {
      allowed: false,
      reason: "daily",
      message: "The demo used today's allowance of Claude calls. It resets at midnight UTC.",
      retryAt: nextUtcMidnight(now),
    };
  }
  return { allowed: true };
}

export interface McpLimitCounts {
  /** Live runs every MCP session together started in the last hour. */
  mcpRuns: WindowCount;
  mcpClaudeCallsToday: number;
  claudeCallsToday: number;
}

/**
 * Whether a run an outside assistant asked for over MCP may start. Claude
 * app connectors all arrive from Anthropic's servers, so MCP runs skip the
 * per browser and per network limits. They share one hourly limit and at
 * most 150 of the day's Claude calls instead, which keeps 250 for the web
 * demo. Each refusal is one sentence that says when to try again.
 */
export function decideMcpRunLimit(counts: McpLimitCounts, kind: AgentRunKind, now: Date, limits: RunLimits = RUN_LIMITS): LimitDecision {
  const reserve = MAX_TURNS[kind];
  if (counts.mcpRuns.count >= MCP_LIMITS.planRoomsPerHour) {
    const retryAt = slotOpens(counts.mcpRuns, now);
    return {
      allowed: false,
      reason: "mcp_hour",
      message: `Outside assistants planned ${MCP_LIMITS.planRoomsPerHour} rooms through Roomover's MCP server in the last hour, the most the demo allows, so try again after ${retryAt.toISOString()}.`,
      retryAt,
    };
  }
  const midnight = nextUtcMidnight(now);
  if (counts.mcpClaudeCallsToday + reserve > MCP_LIMITS.claudeCallsPerDay) {
    return { allowed: false, reason: "mcp_daily", message: `Outside assistants used today's ${MCP_LIMITS.claudeCallsPerDay} Claude calls for MCP, so try again after ${midnight.toISOString()} when the allowance resets.`, retryAt: midnight };
  }
  if (counts.claudeCallsToday + reserve > limits.claudeCallsPerDay) {
    return { allowed: false, reason: "daily", message: `The demo used today's ${limits.claudeCallsPerDay} Claude calls, so try again after ${midnight.toISOString()} when the allowance resets.`, retryAt: midnight };
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

/** Live verifier comparisons one browser may run per rolling hour. Each takes one or two Claude calls. */
export const COMPARISONS_PER_HOUR = 30;
const CALLS_PER_COMPARISON = 2;

/** Whether a live comparison may start, against the session's hourly count and the shared daily allowance. */
export function decideComparisonLimit(counts: { session: WindowCount; claudeCallsToday: number }, now: Date, limits: RunLimits = RUN_LIMITS): LimitDecision {
  if (counts.session.count >= COMPARISONS_PER_HOUR) {
    return {
      allowed: false,
      reason: "session",
      message: `This browser compared ${COMPARISONS_PER_HOUR} photos in the last hour, the most the demo allows.`,
      retryAt: slotOpens(counts.session, now),
    };
  }
  if (counts.claudeCallsToday + CALLS_PER_COMPARISON > limits.claudeCallsPerDay) {
    return { allowed: false, reason: "daily", message: "The demo used today's allowance of Claude calls. It resets at midnight UTC.", retryAt: nextUtcMidnight(now) };
  }
  return { allowed: true };
}
