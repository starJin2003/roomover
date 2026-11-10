import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunConflictError, RunLimitError } from "@/lib/agents/limits";
import { RECORDED_RUN, REPLAY_SENTENCE } from "@/lib/agents/buyer/recorded";

/**
 * POST /api/plans when a live run would pass the demo's limits. The route
 * swaps in the recorded Harbor Hall 214 run, so the student never meets a
 * refusal on Furnish.
 */

const PRESETS = [
  { id: "preset-harbor", slug: "harbor-hall-double", hallName: "Harbor Hall", name: "Harbor Hall double" },
  { id: "preset-birchwood", slug: "birchwood-house-single", hallName: "Birchwood House", name: "Birchwood House single" },
];

const state = vi.hoisted(() => ({
  refuse: null as null | "limit" | "conflict",
  plans: [] as { id: string; roomPresetId: string; roomNumber: string | null; budgetCents: number; stylePrompt: string }[],
  deleted: 0,
  runs: [] as { planId: string; replay: boolean | undefined; clientHash: string }[],
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({ delete: () => ({ where: async () => void (state.deleted += 1) }) }) }));
vi.mock("@/lib/db/plans", () => ({
  loadPresetsWithRules: async () => PRESETS,
  createPlan: async (_db: unknown, input: { roomPresetId: string; roomNumber: string | null; budgetCents: number; stylePrompt: string }) => {
    const id = `plan-${state.plans.length + 1}`;
    state.plans.push({ id, ...input });
    return id;
  },
  loadSessionPlan: async (_db: unknown, id: string) => state.plans.find((plan) => plan.id === id) ?? null,
}));
vi.mock("@/lib/agents/buyer/run", () => ({
  roomLabel: (preset: { hallName: string; name: string }, room: string | null) => (room === null ? preset.name : `${preset.hallName} ${room}`),
  startBuyerRun: async (input: { plan: { id: string }; replay?: boolean; clientHash: string }) => {
    state.runs.push({ planId: input.plan.id, replay: input.replay, clientHash: input.clientHash });
    if (input.replay !== true && state.refuse === "limit") {
      throw new RunLimitError({ allowed: false, reason: "daily", message: "The demo used today's allowance of Claude calls. It resets at midnight UTC.", retryAt: new Date("2026-11-11T00:00:00Z") });
    }
    if (state.refuse === "conflict") throw new RunConflictError();
    return { id: `run-${state.runs.length}` };
  },
}));

const { POST } = await import("@/app/api/plans/route");

const request = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://127.0.0.1:3000/api/plans", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
  vi.stubEnv("APP_URL", "http://127.0.0.1:3000/");
  state.refuse = null;
  state.plans = [];
  state.deleted = 0;
  state.runs = [];
});

describe("POST /api/plans", () => {
  it("starts a live run in the room and words the student chose", async () => {
    const response = await POST(request({ presetSlug: "birchwood-house-single", prompt: "$90, quiet" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ planId: "plan-1", runId: "run-1", roomLabel: "Birchwood House single", presetSlug: "birchwood-house-single", stylePrompt: "$90, quiet", replayed: false });
    expect(state.runs.map((run) => run.replay)).toEqual([false]);
  });

  it("replays the recorded Harbor Hall 214 run when a limit would refuse the live one", async () => {
    state.refuse = "limit";
    const response = await POST(request({ presetSlug: "birchwood-house-single", prompt: "$90, quiet" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ planId: "plan-2", runId: "run-2", roomLabel: "Harbor Hall 214", presetSlug: RECORDED_RUN.presetSlug, stylePrompt: RECORDED_RUN.prompt, replayed: true });
    // The refused plan goes, and the replay gets a plan of its own with the recorded words and budget.
    expect(state.deleted).toBe(1);
    expect(state.plans[1]).toMatchObject({ roomPresetId: "preset-harbor", roomNumber: "214", budgetCents: 15_000, stylePrompt: "$150, cozy, I study late" });
    expect(state.runs.map((run) => run.replay)).toEqual([false, true]);
  });

  it("keys the network limit on the address Cloudflare saw", async () => {
    await POST(request({ presetSlug: "harbor-hall-double", prompt: "$150, cozy" }, { "x-forwarded-for": "160.79.104.10, 203.0.113.7", "cf-connecting-ip": "203.0.113.7" }));
    await POST(request({ presetSlug: "harbor-hall-double", prompt: "$150, cozy" }, { "x-forwarded-for": "198.51.100.1, 203.0.113.7", "cf-connecting-ip": "203.0.113.7" }));
    expect(state.runs[0].clientHash).toBe(state.runs[1].clientHash);
  });

  it("still answers 409 when another run holds the plan", async () => {
    state.refuse = "conflict";
    const response = await POST(request({ presetSlug: "harbor-hall-double", prompt: "$150, cozy" }));
    expect(response.status).toBe(409);
  });

  it("says in one sentence that the live budget is used up, the room replays, and PayPal stays live", () => {
    expect(REPLAY_SENTENCE).toBe("Today's live agent budget is used up, so this room replays a recorded run, and PayPal and everything after it are live.");
    expect(REPLAY_SENTENCE.match(/\. |\.$/g)).toHaveLength(1);
  });
});
