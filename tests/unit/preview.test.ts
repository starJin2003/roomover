import { describe, expect, it } from "vitest";
import { agentEventDetailSchema } from "@/lib/domain/agent-events";
import type { ActivityEventView } from "@/lib/plan-view";
import { plannerOf, previewNotice } from "@/lib/preview";

const event = (seq: number, detail: ActivityEventView["detail"]): ActivityEventView => ({
  seq,
  runId: "11111111-1111-4111-8111-111111111111",
  at: "2026-11-09T18:00:00Z",
  agent: "platform",
  tool: "mcp_plan_room",
  summary: "",
  sentence: null,
  blocked: false,
  detail,
  paypal: null,
});

describe("the preview page", () => {
  it("turns PayPal's cancel and the return route's failures into one sentence each", () => {
    expect(previewNotice("canceled")).toEqual({ tone: "info", text: "You left PayPal before approving, so nothing was charged. Press PayPal when you are ready." });
    expect(previewNotice("declined")).toEqual({
      tone: "error",
      text: "PayPal declined that payment method, so nothing was charged. Press PayPal again and choose another card or your PayPal balance.",
    });
    expect(previewNotice("expired")?.tone).toBe("error");
    expect(previewNotice("taken")?.text).toMatch(/^Another student just bought an item in this room/);
    expect(previewNotice(undefined)).toBeNull();
    expect(previewNotice("<script>")).toBeNull();
  });

  it("names who planned the room from the first line that came over MCP", () => {
    expect(plannerOf([event(1, {}), event(2, { mcp: { tool: "plan_room", client: "claude-code" } }), event(3, { mcp: { tool: "create_checkout", client: "other" } })])).toBe("Claude Code");
    expect(plannerOf([event(1, {})])).toBe("An outside assistant");
    expect(plannerOf([event(1, { mcp: { tool: "plan_room", client: "claude-code", fromAnthropic: true } })])).toBe("Claude");
  });

  it("stores the MCP tool and client on an activity line and refuses tools the server does not have", () => {
    expect(agentEventDetailSchema.parse({ mcp: { tool: "plan_room", client: "claude-code" }, latencyMs: 31_200 })).toEqual({ mcp: { tool: "plan_room", client: "claude-code" }, latencyMs: 31_200 });
    expect(agentEventDetailSchema.safeParse({ mcp: { tool: "delete_everything", client: "x" } }).success).toBe(false);
    const full = { mcp: { tool: "create_checkout", client: "claude-code", clientVersion: "2.1.274", fromAnthropic: false } };
    expect(agentEventDetailSchema.parse(full)).toEqual(full);
  });
});
