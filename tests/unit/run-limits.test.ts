import { describe, expect, it } from "vitest";
import { MAX_TURNS } from "@/lib/agents/buyer/loop";
import { decideLimit, nextUtcMidnight, RUN_LIMITS, startOfUtcDay, type LimitCounts } from "@/lib/agents/limits";

const NOW = new Date("2026-11-08T20:30:00Z");
const free: LimitCounts = { session: { count: 0, oldest: null }, client: { count: 0, oldest: null }, claudeCallsToday: 0 };

describe("decideLimit", () => {
  it("holds the demo to 6 runs per browser and 15 per network each hour, and 400 Claude calls a day", () => {
    expect(RUN_LIMITS).toEqual({ sessionRunsPerHour: 6, clientRunsPerHour: 15, claudeCallsPerDay: 400 });
  });

  it("allows a run under every limit", () => {
    expect(decideLimit(free, "plan", NOW)).toEqual({ allowed: true });
  });

  it("stops a browser after its hourly runs and says when a slot opens", () => {
    const oldest = new Date("2026-11-08T19:45:00Z");
    const decision = decideLimit({ ...free, session: { count: RUN_LIMITS.sessionRunsPerHour, oldest } }, "edit", NOW);
    expect(decision).toEqual({
      allowed: false,
      reason: "session",
      message: "This browser started 6 agent runs in the last hour, the most the demo allows.",
      retryAt: new Date("2026-11-08T20:45:00Z"),
    });
  });

  it("stops a network after its hourly runs", () => {
    const decision = decideLimit({ ...free, client: { count: RUN_LIMITS.clientRunsPerHour, oldest: new Date("2026-11-08T20:00:00Z") } }, "plan", NOW);
    expect(decision).toMatchObject({ allowed: false, reason: "client", retryAt: new Date("2026-11-08T21:00:00Z") });
  });

  it("reserves a run's worst case against the daily Claude allowance", () => {
    const room = RUN_LIMITS.claudeCallsPerDay - MAX_TURNS.plan;
    expect(decideLimit({ ...free, claudeCallsToday: room }, "plan", NOW)).toEqual({ allowed: true });
    expect(decideLimit({ ...free, claudeCallsToday: room + 1 }, "plan", NOW)).toMatchObject({
      allowed: false,
      reason: "daily",
      retryAt: new Date("2026-11-09T00:00:00Z"),
    });
    // An edit reserves fewer calls, so it can still start.
    expect(decideLimit({ ...free, claudeCallsToday: room + 1 }, "edit", NOW)).toEqual({ allowed: true });
  });

  it("checks the browser before the network before the day", () => {
    const everything: LimitCounts = { session: { count: 99, oldest: NOW }, client: { count: 99, oldest: NOW }, claudeCallsToday: 9_999 };
    expect(decideLimit(everything, "plan", NOW)).toMatchObject({ reason: "session" });
  });
});

describe("UTC day bounds", () => {
  it("finds the start of the day and the next midnight", () => {
    expect(startOfUtcDay(NOW)).toEqual(new Date("2026-11-08T00:00:00Z"));
    expect(nextUtcMidnight(new Date("2026-12-31T23:59:00Z"))).toEqual(new Date("2027-01-01T00:00:00Z"));
  });
});
