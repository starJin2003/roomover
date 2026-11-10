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

export interface McpSessionState {
  id: string;
  /** When the session last sent a request. */
  lastActive: number;
  /** POST requests still answering, such as a plan_room run. */
  inFlight: number;
}

export type McpSessionOpenDecision = { action: "open" } | { action: "evict"; sessionId: string } | { action: "refuse"; message: string };

/**
 * How a new MCP session opens under the demo's cap of 300. A full table
 * closes the session idle longest, one with no request still answering, so
 * a burst of initialize calls never locks real assistants out. Only a table
 * where every session is answering a request refuses.
 */
export function decideMcpSessionOpen(sessions: readonly McpSessionState[]): McpSessionOpenDecision {
  if (sessions.length < MCP_LIMITS.openSessions) return { action: "open" };
  const idle = sessions.filter((session) => session.inFlight === 0).sort((a, b) => a.lastActive - b.lastActive)[0];
  if (idle !== undefined) return { action: "evict", sessionId: idle.id };
  return { action: "refuse", message: `Roomover has ${MCP_LIMITS.openSessions} MCP sessions open and every one is answering a request, so try again in a few minutes.` };
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

/**
 * The MCP client as Roomover records it: the name and version from its
 * clientInfo, and whether the session arrived from Anthropic's servers.
 */
export interface McpClient {
  name: string | undefined;
  version: string | undefined;
  fromAnthropic: boolean;
}

/**
 * Anthropic's outbound ranges, which Claude app connectors call MCP servers
 * from (https://platform.claude.com/docs/en/api/ip-addresses). Claude Code
 * connects from the user's own machine.
 */
const ANTHROPIC_OUTBOUND = [
  ["160.79.104.0", 21],
  ["153.61.208.0", 20],
] as const;

const ipv4Number = (address: string): number | null => {
  const parts = address.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return null;
  return parts.reduce((total, part) => total * 256 + Number(part), 0);
};

/** Whether a client address falls in Anthropic's outbound ranges. IPv4 only, as Anthropic publishes them. */
export function isAnthropicAddress(address: string): boolean {
  const value = ipv4Number(address.replace(/^::ffff:/, ""));
  if (value === null) return false;
  return ANTHROPIC_OUTBOUND.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    const start = ipv4Number(base) ?? 0;
    return value >= start && value < start + size;
  });
}

/**
 * What the activity panel calls the assistant. The Claude app's connectors
 * report the clientInfo name claude-code, the same name Claude Code reports,
 * so a session from Anthropic's servers is the Claude app whatever its name.
 */
export function assistantName(clientName: string | undefined, fromAnthropic = false): string {
  if (fromAnthropic) return "Claude";
  if (clientName === undefined) return "An outside assistant";
  if (/claude[-_ ]?code/i.test(clientName)) return "Claude Code";
  if (/claude|anthropic/i.test(clientName)) return "Claude";
  if (/inspector/i.test(clientName)) return "MCP Inspector";
  return "An outside assistant";
}

/** "An outside assistant" reads as "an outside assistant" inside a sentence. Names keep their capital. */
export const assistantInSentence = (name: string) => name.replace(/^An /, "an ");

/** The client fields an MCP line keeps in agent_events, with the clientInfo name and version as the client sent them. */
export function mcpClientDetail(client: McpClient): { client: string; clientVersion?: string; fromAnthropic: boolean } {
  const name = client.name?.trim().slice(0, 80);
  const version = client.version?.trim().slice(0, 80);
  return { client: name === undefined || name === "" ? "unnamed" : name, ...(version === undefined || version === "" ? {} : { clientVersion: version }), fromAnthropic: client.fromAnthropic };
}

/** The page a student opens to see a plan and approve it. */
export const previewPath = (planId: string) => `/p/${planId}`;
/** Where PayPal sends the student after approving, which authorizes or captures the order. */
export const approvedPath = (planId: string) => `/p/${planId}/approved`;
