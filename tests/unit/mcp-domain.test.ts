import { describe, expect, it } from "vitest";
import { checkoutReturnUrls } from "@/lib/checkout/prepare";
import { assistantName, decideMcpPlanLimit, decideMcpSessionOpen, isSharedPlanSession, MCP_LIMITS } from "@/lib/domain/mcp";
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

  it("shares only plans an MCP session made", () => {
    expect(isSharedPlanSession("mcp-abcdefghijklmnopqrst")).toBe(true);
    expect(isSharedPlanSession("e2e-abcdefghijklmnopqrst")).toBe(false);
    expect(isSharedPlanSession("abcdefghijklmnopqrstuvwx")).toBe(false);
    expect(isSharedPlanSession(null)).toBe(false);
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
    expect(refused.message).toBe("This MCP session planned 3 rooms in the last hour, the most the demo allows. Use create_checkout on one of them, or try again after 2026-11-09T18:10:00.000Z.");
  });

  it("caps open sessions across the demo and from one network", () => {
    expect(decideMcpSessionOpen({ total: 0, fromClient: 0 })).toEqual({ allowed: true });
    expect(decideMcpSessionOpen({ total: MCP_LIMITS.openSessions, fromClient: 0 }).allowed).toBe(false);
    expect(decideMcpSessionOpen({ total: 10, fromClient: MCP_LIMITS.openSessionsPerClient }).allowed).toBe(false);
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
});

describe("PayPal return links", () => {
  it("sends a browser's own plan back to Furnish and an MCP plan back to its preview", () => {
    const planId = "1f0e8a1c-6c1e-4d1a-9a3e-2b9b2b0f6a11";
    expect(checkoutReturnUrls("https://roomover.onrender.com", { id: planId, sessionId: "abcdefghijklmnopqrstuvwx" })).toEqual({
      returnUrl: "https://roomover.onrender.com/furnish",
      cancelUrl: "https://roomover.onrender.com/furnish",
    });
    expect(checkoutReturnUrls("https://roomover.onrender.com/", { id: planId, sessionId: "mcp-abcdefghijklmnopqrst" })).toEqual({
      returnUrl: `https://roomover.onrender.com/p/${planId}/approved`,
      cancelUrl: `https://roomover.onrender.com/p/${planId}?paypal=canceled`,
    });
  });

  it("joins paths whether or not APP_URL ends in a slash", () => {
    expect(absoluteUrl("http://127.0.0.1:3000/", "/p/x")).toBe("http://127.0.0.1:3000/p/x");
    expect(absoluteUrl("http://127.0.0.1:3000", "/p/x")).toBe("http://127.0.0.1:3000/p/x");
  });
});
