import { describe, expect, it } from "vitest";
import { checkoutReturnUrls } from "@/lib/checkout/prepare";
import { decideMcpRunLimit, RUN_LIMITS } from "@/lib/agents/limits";
import { assistantName, decideMcpPlanLimit, decideMcpSessionOpen, isAnthropicAddress, isMcpSession, MCP_LIMITS, mcpClientDetail, planClaimStep } from "@/lib/domain/mcp";
import { mcpBuyerSession } from "@/lib/session";
import { absoluteUrl } from "@/lib/site";

const now = new Date("2026-11-09T18:00:00Z");

describe("MCP buyer sessions", () => {
  it("keys each MCP session to its own tagged buyer session", () => {
    const one = mcpBuyerSession("7b8e5c1e-0000-4000-8000-000000000001", "secret-a".repeat(4));
    expect(one).toMatch(/^mcp-[A-Za-z0-9_-]{20}$/);
    expect(mcpBuyerSession("7b8e5c1e-0000-4000-8000-000000000001", "secret-a".repeat(4))).toBe(one);
    expect(mcpBuyerSession("7b8e5c1e-0000-4000-8000-000000000002", "secret-a".repeat(4))).not.toBe(one);
    expect(mcpBuyerSession("7b8e5c1e-0000-4000-8000-000000000001", "secret-b".repeat(4))).not.toBe(one);
  });

  it("tells MCP buyer sessions from browser sessions", () => {
    expect(isMcpSession("mcp-abcdefghijklmnopqrst")).toBe(true);
    expect(isMcpSession("e2e-abcdefghijklmnopqrst")).toBe(false);
    expect(isMcpSession("abcdefghijklmnopqrstuvwx")).toBe(false);
    expect(isMcpSession(null)).toBe(false);
  });
});

describe("MCP limits", () => {
  it("lets one MCP session plan 3 rooms in a rolling hour", () => {
    expect(MCP_LIMITS.planRoomsPerSessionPerHour).toBe(3);
    expect(decideMcpPlanLimit({ count: 2, oldest: new Date(now.getTime() - 50 * 60_000) }, now)).toEqual({ allowed: true });
    const refused = decideMcpPlanLimit({ count: 3, oldest: new Date(now.getTime() - 50 * 60_000) }, now);
    expect(refused.allowed).toBe(false);
    if (refused.allowed) return;
    expect(refused.retryAt).toEqual(new Date(now.getTime() + 10 * 60_000));
    expect(refused.message).toBe("This MCP session planned 3 rooms in the last hour, the most the demo allows, so use create_checkout on one of them or try again after 2026-11-09T18:10:00.000Z.");
  });

  it("caps open sessions across the demo only, since every Claude app connector shares Anthropic's network", () => {
    expect(MCP_LIMITS.openSessions).toBe(300);
    expect(decideMcpSessionOpen({ total: 299 })).toEqual({ allowed: true });
    const refused = decideMcpSessionOpen({ total: 300 });
    expect(refused).toEqual({ allowed: false, message: "Roomover has 300 MCP sessions open, the most the demo allows, so try again in a few minutes once idle ones close." });
  });

  const counts = (over: Partial<Parameters<typeof decideMcpRunLimit>[0]> = {}) => ({ mcpRuns: { count: 0, oldest: null }, mcpClaudeCallsToday: 0, claudeCallsToday: 0, ...over });

  it("lets every MCP session together start 10 runs in a rolling hour, with no per network count", () => {
    expect(MCP_LIMITS.planRoomsPerHour).toBe(10);
    expect(decideMcpRunLimit(counts({ mcpRuns: { count: 9, oldest: new Date(now.getTime() - 40 * 60_000) } }), "plan", now)).toEqual({ allowed: true });
    const refused = decideMcpRunLimit(counts({ mcpRuns: { count: 10, oldest: new Date(now.getTime() - 40 * 60_000) } }), "plan", now);
    expect(refused).toEqual({
      allowed: false,
      reason: "mcp_hour",
      message: "Outside assistants planned 10 rooms through Roomover's MCP server in the last hour, the most the demo allows, so try again after 2026-11-09T18:20:00.000Z.",
      retryAt: new Date("2026-11-09T18:20:00.000Z"),
    });
  });

  it("caps MCP at 150 of the 400 daily Claude calls, reserving a whole run, so the web demo keeps 250", () => {
    expect(MCP_LIMITS.claudeCallsPerDay).toBe(150);
    expect(RUN_LIMITS.claudeCallsPerDay - MCP_LIMITS.claudeCallsPerDay).toBe(250);
    expect(decideMcpRunLimit(counts({ mcpClaudeCallsToday: 120, claudeCallsToday: 300 }), "plan", now)).toEqual({ allowed: true });
    const mcp = decideMcpRunLimit(counts({ mcpClaudeCallsToday: 121, claudeCallsToday: 121 }), "plan", now);
    expect(mcp).toMatchObject({ allowed: false, reason: "mcp_daily", message: "Outside assistants used today's 150 Claude calls for MCP, so try again after 2026-11-10T00:00:00.000Z when the allowance resets." });
    const total = decideMcpRunLimit(counts({ mcpClaudeCallsToday: 10, claudeCallsToday: 371 }), "plan", now);
    expect(total).toMatchObject({ allowed: false, reason: "daily", message: "The demo used today's 400 Claude calls, so try again after 2026-11-10T00:00:00.000Z when the allowance resets." });
  });

  it("writes every refusal as one sentence that says when to try again", () => {
    const refusals = [
      decideMcpPlanLimit({ count: 3, oldest: now }, now),
      decideMcpRunLimit(counts({ mcpRuns: { count: 10, oldest: now } }), "plan", now),
      decideMcpRunLimit(counts({ mcpClaudeCallsToday: 150 }), "plan", now),
      decideMcpRunLimit(counts({ claudeCallsToday: 400 }), "plan", now),
      decideMcpSessionOpen({ total: 300 }),
    ];
    for (const refusal of refusals) {
      expect(refusal.allowed).toBe(false);
      const message = refusal.allowed ? "" : refusal.message;
      expect(message.match(/\. |\.$/g)).toHaveLength(1);
      expect(message).toMatch(/try again/);
    }
  });
});

describe("plan claims", () => {
  it("hands a held MCP plan to the first approving browser only", () => {
    expect(planClaimStep({ mcpSessionId: "mcp-abcdefghijklmnopqrst", claimedAt: null }, true)).toBe("claim");
    expect(planClaimStep({ mcpSessionId: "mcp-abcdefghijklmnopqrst", claimedAt: now }, true)).toBe("claimed");
    expect(planClaimStep({ mcpSessionId: "mcp-abcdefghijklmnopqrst", claimedAt: null }, false)).toBe("not_held");
    expect(planClaimStep({ mcpSessionId: null, claimedAt: null }, true)).toBe("not_shared");
  });
});

describe("assistant names", () => {
  it("names Claude clients and falls back to an outside assistant", () => {
    expect(assistantName("claude-code")).toBe("Claude Code");
    expect(assistantName("Claude Code")).toBe("Claude Code");
    expect(assistantName("claude-ai")).toBe("Claude");
    expect(assistantName("Anthropic/ClaudeAI")).toBe("Claude");
    expect(assistantName("mcp-inspector")).toBe("MCP Inspector");
    expect(assistantName("roomover-e2e")).toBe("An outside assistant");
    expect(assistantName(undefined)).toBe("An outside assistant");
  });

  it("names a session from Anthropic's servers Claude, since the Claude app's connector reports claude-code", () => {
    expect(assistantName("claude-code", true)).toBe("Claude");
    expect(assistantName("claude-code", false)).toBe("Claude Code");
    expect(assistantName(undefined, true)).toBe("Claude");
  });

  it("knows Anthropic's published outbound ranges and nothing next to them", () => {
    expect(isAnthropicAddress("160.79.104.0")).toBe(true);
    expect(isAnthropicAddress("160.79.111.255")).toBe(true);
    expect(isAnthropicAddress("160.79.112.0")).toBe(false);
    expect(isAnthropicAddress("153.61.208.9")).toBe(true);
    expect(isAnthropicAddress("153.61.223.255")).toBe(true);
    expect(isAnthropicAddress("153.61.224.1")).toBe(false);
    expect(isAnthropicAddress("::ffff:160.79.105.7")).toBe(true);
    expect(isAnthropicAddress("73.22.140.8")).toBe(false);
    expect(isAnthropicAddress("2607:6bc0::1")).toBe(false);
    expect(isAnthropicAddress("unknown")).toBe(false);
    expect(isAnthropicAddress("160.79.104.256")).toBe(false);
  });

  it("keeps the raw clientInfo name and version on an activity line", () => {
    expect(mcpClientDetail({ name: "claude-code", version: "2.1.274", fromAnthropic: false })).toEqual({ client: "claude-code", clientVersion: "2.1.274", fromAnthropic: false });
    expect(mcpClientDetail({ name: undefined, version: "", fromAnthropic: true })).toEqual({ client: "unnamed", fromAnthropic: true });
    expect(mcpClientDetail({ name: "x".repeat(120), version: undefined, fromAnthropic: false }).client).toHaveLength(80);
  });
});

describe("PayPal return links", () => {
  it("sends a browser's own plan back to Furnish and an MCP plan back to its preview", () => {
    const planId = "1f0e8a1c-6c1e-4d1a-9a3e-2b9b2b0f6a11";
    expect(checkoutReturnUrls("https://roomover.onrender.com", { id: planId, mcpSessionId: null })).toEqual({
      returnUrl: "https://roomover.onrender.com/furnish",
      cancelUrl: "https://roomover.onrender.com/furnish",
    });
    expect(checkoutReturnUrls("https://roomover.onrender.com/", { id: planId, mcpSessionId: "mcp-abcdefghijklmnopqrst" })).toEqual({
      returnUrl: `https://roomover.onrender.com/p/${planId}/approved`,
      cancelUrl: `https://roomover.onrender.com/p/${planId}?paypal=canceled`,
    });
  });

  it("joins paths whether or not APP_URL ends in a slash", () => {
    expect(absoluteUrl("http://127.0.0.1:3000/", "/p/x")).toBe("http://127.0.0.1:3000/p/x");
    expect(absoluteUrl("http://127.0.0.1:3000", "/p/x")).toBe("http://127.0.0.1:3000/p/x");
  });
});
