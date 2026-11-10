import type { WindowCount } from "@/lib/agents/limits";

/**
 * Roomover's MCP server lets an outside assistant shop for a student. Each
 * MCP session acts as the demo buyer through a buyer session of its own,
 * which makes the plans, and anyone holding a plan's preview link can look
 * at it and approve its payment in PayPal. The first browser to approve
 * takes the plan over for the handoff, and the MCP session keeps reading it.
 */

export const MCP_TOOL_NAMES = ["search_listings", "get_room_presets", "plan_room", "create_checkout"] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/** Buyer sessions that MCP sessions act through start with this tag, which also marks their plans as shareable. */
export const MCP_SESSION_TAG = "mcp-";

export const MCP_LIMITS = {
  /** Rooms one MCP session may plan in a rolling hour. */
  planRoomsPerSessionPerHour: 3,
  /** Rooms every MCP session together may plan in a rolling hour. Claude app connectors all arrive from Anthropic's servers, so no per network limit applies. */
  planRoomsPerHour: 10,
  /** The share of the demo's 400 daily Claude calls MCP runs may spend, so the web demo always keeps 250. */
  claudeCallsPerDay: 150,
  /** Open MCP sessions across the demo. */
  openSessions: 300,
  /** A session with no request for this long closes, and its client starts a new one. */
  idleMs: 30 * 60 * 1000,
  /** How long plan_room waits for the buyer agent before it answers with the preview link alone. */
  planWaitMs: 170_000,
} as const;

const HOUR_MS = 60 * 60 * 1000;

/** The buyer session an MCP session acts through, whose agent runs count against the MCP limits. */
export function isMcpSession(sessionId: string | null): boolean {
  return sessionId !== null && sessionId.startsWith(MCP_SESSION_TAG);
}

export type McpLimitDecision = { allowed: true } | { allowed: false; message: string; retryAt: Date };

/** Whether an MCP session may plan another room this hour. */
export function decideMcpPlanLimit(recent: WindowCount, now: Date, limit: number = MCP_LIMITS.planRoomsPerSessionPerHour): McpLimitDecision {
  if (recent.count < limit) return { allowed: true };
  const retryAt = new Date((recent.oldest ?? now).getTime() + HOUR_MS);
  return { allowed: false, message: `This MCP session planned ${limit} rooms in the last hour, the most the demo allows, so use create_checkout on one of them or try again after ${retryAt.toISOString()}.`, retryAt };
}

/** Whether a new MCP session may open under the demo's cap. Idle sessions close after 30 minutes and free their place. */
export function decideMcpSessionOpen(open: { total: number }): { allowed: true } | { allowed: false; message: string } {
  if (open.total >= MCP_LIMITS.openSessions) return { allowed: false, message: `Roomover has ${MCP_LIMITS.openSessions} MCP sessions open, the most the demo allows, so try again in a few minutes once idle ones close.` };
  return { allowed: true };
}

/** A browser that approves a preview link's payment, which takes the plan over for the handoff. */
export interface PlanClaim {
  sessionId: string;
  at: Date;
}

export type ClaimStep = "claim" | "claimed" | "not_shared" | "not_held";

/**
 * Whether an approval hands the plan to the approving browser. Only a plan
 * an MCP session made, and only while its payment is held, and only once:
 * the first approval wins and later visits see the plan read only.
 */
export function planClaimStep(plan: { mcpSessionId: string | null; claimedAt: Date | null }, moneyHeld: boolean): ClaimStep {
  if (plan.mcpSessionId === null) return "not_shared";
  if (plan.claimedAt !== null) return "claimed";
  return moneyHeld ? "claim" : "not_held";
}

/** What the activity panel calls the assistant, from the name its MCP client reports. */
export function assistantName(clientName: string | undefined): string {
  if (clientName === undefined) return "An outside assistant";
  if (/claude[-_ ]?code/i.test(clientName)) return "Claude Code";
  if (/claude|anthropic/i.test(clientName)) return "Claude";
  if (/inspector/i.test(clientName)) return "MCP Inspector";
  return "An outside assistant";
}

/** The page a student opens to see a plan and approve it. */
export const previewPath = (planId: string) => `/p/${planId}`;
/** Where PayPal sends the student after approving, which authorizes or captures the order. */
export const approvedPath = (planId: string) => `/p/${planId}/approved`;
