import type { WindowCount } from "@/lib/agents/limits";

/**
 * Roomover's MCP server lets an outside assistant shop for a student. Each
 * MCP session acts as the demo buyer through a buyer session of its own,
 * which owns the plans it makes, and anyone holding a plan's preview link
 * can look at it and approve its payment in PayPal.
 */

export const MCP_TOOL_NAMES = ["search_listings", "get_room_presets", "plan_room", "create_checkout"] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/** Buyer sessions that MCP sessions act through start with this tag, which also marks their plans as shareable. */
export const MCP_SESSION_TAG = "mcp-";

export const MCP_LIMITS = {
  /** Rooms one MCP session may plan in a rolling hour, on top of the demo's network and daily limits. */
  planRoomsPerSessionPerHour: 3,
  /** Open MCP sessions across the demo, and from one network. */
  openSessions: 300,
  openSessionsPerClient: 30,
  /** A session with no request for this long closes, and its client starts a new one. */
  idleMs: 30 * 60 * 1000,
  /** How long plan_room waits for the buyer agent before it answers with the preview link alone. */
  planWaitMs: 170_000,
} as const;

const HOUR_MS = 60 * 60 * 1000;

/** Plans an MCP session made are the only ones a preview link opens. */
export function isSharedPlanSession(sessionId: string | null): boolean {
  return sessionId !== null && sessionId.startsWith(MCP_SESSION_TAG);
}

export type McpLimitDecision = { allowed: true } | { allowed: false; message: string; retryAt: Date };

/** Whether an MCP session may plan another room this hour. */
export function decideMcpPlanLimit(recent: WindowCount, now: Date, limit: number = MCP_LIMITS.planRoomsPerSessionPerHour): McpLimitDecision {
  if (recent.count < limit) return { allowed: true };
  const retryAt = new Date((recent.oldest ?? now).getTime() + HOUR_MS);
  return { allowed: false, message: `This MCP session planned ${limit} rooms in the last hour, the most the demo allows. Use create_checkout on one of them, or try again after ${retryAt.toISOString()}.`, retryAt };
}

/** Whether a new MCP session may open, against the demo's cap and the cap for one network. */
export function decideMcpSessionOpen(open: { total: number; fromClient: number }): { allowed: true } | { allowed: false; message: string } {
  if (open.total >= MCP_LIMITS.openSessions) return { allowed: false, message: "Roomover has too many MCP sessions open right now. Try again in a few minutes." };
  if (open.fromClient >= MCP_LIMITS.openSessionsPerClient) return { allowed: false, message: "Your network has too many Roomover MCP sessions open. Close one or wait 30 minutes." };
  return { allowed: true };
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
