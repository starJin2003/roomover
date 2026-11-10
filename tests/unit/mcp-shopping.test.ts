import { describe, expect, it, vi } from "vitest";
import type { RoomItemData } from "@/components/room/types";
import type { PresetWithRules } from "@/lib/db/plans";
import type { PlanView } from "@/lib/plan-view";
import { createCheckout, createCheckoutInput, planRoom, planRoomInput, planSummary, type CreateCheckoutDeps, type McpCaller, type PlanRoomDeps, type PreparedOrder } from "@/mcp/shopping";

const PLAN_ID = "5b1d1b8e-3f5a-4c1e-9d2a-6f1b2c3d4e5f";
const caller: McpCaller = { buyerSession: "mcp-abcdefghijklmnopqrst", clientHash: "hash", clientName: "claude-code" };
const harbor = { id: "preset-harbor", slug: "harbor-hall-double", name: "Harbor Hall double", hallName: "Harbor Hall" } as PresetWithRules;

const item = (title: string, sellerName: string, priceCents: number, extra: Partial<RoomItemData> = {}): RoomItemData =>
  ({
    layout: (extra.newFrom === undefined ? { key: title, source: "listing", listingId: `listing-${sellerName}` } : { key: title, source: "new_product" }) as RoomItemData["layout"],
    title,
    condition: "Good",
    priceCents,
    sellerName,
    color: "white",
    colors: [],
    ...extra,
  }) as RoomItemData;

function view(overrides: Partial<PlanView> = {}): PlanView {
  return {
    id: PLAN_ID,
    status: "ready",
    presetSlug: "harbor-hall-double",
    roomLabel: "Harbor Hall 214",
    budgetCents: 15_000,
    stylePrompt: "$150, cozy, I study late",
    items: [
      item("Black balance arm desk lamp", "Ava Lindqvist", 1_500, { listPriceCents: 1_600, slotLabel: "Mon, Nov 23, 10 AM to noon" }),
      item("Round jute rug", "Jun Park", 2_000),
      item("Desk organizer", "Target", 1_299, { newFrom: { retailer: "target.com", buyUrl: "https://buy.trychannel3.com/x" } }),
    ],
    totalCents: 4_799,
    usedCents: 3_500,
    newItemsCents: 1_299,
    savings: { paidCents: 3_500, newCents: 9_000, savedCents: 5_500, compared: 2, total: 2 },
    negotiations: [],
    run: { id: "run-1", kind: "plan", status: "succeeded", request: null, error: null, startedAt: "2026-11-09T18:00:00Z", finishedAt: "2026-11-09T18:00:30Z" },
    checkout: null,
    ...overrides,
  };
}

function planDeps(overrides: Partial<PlanRoomDeps> = {}): PlanRoomDeps & { recorded: string[]; deleted: string[] } {
  const recorded: string[] = [];
  const deleted: string[] = [];
  return {
    recorded,
    deleted,
    now: () => new Date("2026-11-09T18:00:00Z"),
    appUrl: "https://roomover.example",
    presets: async () => [harbor],
    roomNumberFor: () => "214",
    recentPlans: async () => ({ count: 0, oldest: null }),
    createPlan: async () => ({ id: PLAN_ID, roomLabel: "Harbor Hall 214" }),
    deletePlan: async (planId) => {
      deleted.push(planId);
    },
    recordRequest: async (_planId, record) => {
      recorded.push(record.sentence ?? "");
    },
    startRun: async () => ({ id: "run-1" }),
    refusalOf: (error) => (error instanceof Error && error.name === "RunLimitError" ? error.message : null),
    waitForRun: async (_planId, _runId, onSentence) => {
      onSentence("Measuring Harbor Hall 214, 3.6 by 4.5 meters with 3 windows.");
      onSentence("Your room is ready. 2 items from 2 students and 1 new item.");
      return "finished";
    },
    view: async () => view(),
    handoffModes: async () => new Map([["listing-Jun Park", "storage_hold" as const]]),
    ...overrides,
  };
}

const signal = new AbortController().signal;

describe("plan_room", () => {
  it("runs the buyer agent, passes its sentences on as progress, and answers with the room and a preview link", async () => {
    const deps = planDeps();
    const progress: string[] = [];
    const outcome = await planRoom(deps, caller, planRoomInput.parse({ roomPresetSlug: "harbor-hall-double", request: "$150, cozy, I study late" }), (sentence) => progress.push(sentence), signal);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(progress).toHaveLength(2);
    expect(deps.recorded).toEqual(["Claude Code asked Roomover over MCP to furnish Harbor Hall 214 for “$150, cozy, I study late”"]);
    expect(outcome.data).toMatchObject({ planId: PLAN_ID, status: "ready", paypalTotal: "$35", newItemsTotal: "$12.99", budget: "$150", previewUrl: `https://roomover.example/p/${PLAN_ID}` });
    expect(outcome.data.items[0]).toEqual({
      title: "Black balance arm desk lamp",
      kind: "used",
      from: "Ava Lindqvist",
      price: "$15",
      askingPrice: "$16",
      condition: "Good",
      handoffSlot: "Mon, Nov 23, 10 AM to noon",
      handoffPlace: "Handed over in person by Ava",
      buyUrl: null,
    });
    expect(outcome.data.items[1].handoffPlace).toBe("Waits in campus storage after Jun moves out, ready to collect");
    expect(outcome.data.items[2]).toMatchObject({ kind: "new", from: "Target", condition: "New", handoffPlace: null, buyUrl: "https://buy.trychannel3.com/x" });
    expect(outcome.text).toContain("- Black balance arm desk lamp, from Ava Lindqvist, $15 (asking $16), handed over in person by Ava, Mon, Nov 23, 10 AM to noon");
    expect(outcome.text).toContain("- Round jute rug, from Jun Park, $20, waits in campus storage after Jun moves out, ready to collect");
    expect(outcome.data.summary).toBe("Harbor Hall 214 has 2 used items from 2 students for $35 through one PayPal approval, plus 1 new item for $12.99 the student buys from the retailer, $47.99 of a $150 budget.");
    expect(outcome.data.savings).toBe("$55 less than the cheapest comparable new items on Channel3.");
    expect(outcome.text).toContain(`Preview: https://roomover.example/p/${PLAN_ID}`);
    expect(outcome.data.nextStep).toMatch(/call create_checkout with this planId/);
  });

  it("refuses a request without a budget, an unknown room, and a fourth room in an hour, before any plan exists", async () => {
    const createPlan = vi.fn();
    const deps = planDeps({ createPlan });
    expect(await planRoom(deps, caller, { roomPresetSlug: "harbor-hall-double", request: "cozy, I study late" }, () => undefined, signal)).toMatchObject({ ok: false, message: "Add a budget in dollars, for example $150." });
    expect(await planRoom(deps, caller, { roomPresetSlug: "the-moon", request: "$150" }, () => undefined, signal)).toMatchObject({ ok: false, message: "There is no room called the-moon. Call get_room_presets for the room slugs." });
    const limited = planDeps({ createPlan, recentPlans: async () => ({ count: 3, oldest: new Date("2026-11-09T17:30:00Z") }) });
    const refused = await planRoom(limited, caller, { roomPresetSlug: "harbor-hall-double", request: "$150" }, () => undefined, signal);
    expect(refused.ok).toBe(false);
    expect(refused.ok ? "" : refused.message).toMatch(/^This MCP session planned 3 rooms in the last hour/);
    expect(createPlan).not.toHaveBeenCalled();
  });

  it("deletes the plan when the demo's network or daily limit refuses the run", async () => {
    const limit = Object.assign(new Error("Your network started 15 agent runs in the last hour, the most the demo allows."), { name: "RunLimitError" });
    const deps = planDeps({ startRun: async () => Promise.reject(limit) });
    const outcome = await planRoom(deps, caller, { roomPresetSlug: "harbor-hall-double", request: "$150" }, () => undefined, signal);
    expect(outcome).toMatchObject({ ok: false, message: "Your network started 15 agent runs in the last hour, the most the demo allows." });
    expect(deps.deleted).toEqual([PLAN_ID]);
  });

  it("answers with the preview link alone when the run outlasts the wait", async () => {
    const deps = planDeps({ waitForRun: async () => "timeout", view: async () => view({ run: { ...view().run!, status: "running", finishedAt: null } }) });
    const outcome = await planRoom(deps, caller, { roomPresetSlug: "harbor-hall-double", request: "$150" }, () => undefined, signal);
    expect(outcome.ok && outcome.data.status).toBe("planning");
    expect(outcome.ok && outcome.data.nextStep).toBe("Share previewUrl with the student. Call create_checkout with this planId once the room is ready.");
  });

  it("says when nothing fit", () => {
    expect(planSummary(view({ items: [], usedCents: 0, totalCents: 0, newItemsCents: 0 }))).toBe("Nothing fit Harbor Hall 214 within $150 this time.");
  });
});

const order: PreparedOrder = {
  paypalOrderId: "7YY18853U0064211D",
  created: false,
  approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=7YY18853U0064211D",
  totalCents: 10_700,
  paymentMode: "authorize_then_capture",
  sellerCount: 4,
  lines: [{ title: "Black balance arm desk lamp", sellerName: "Ava Lindqvist", amountCents: 1_500 }],
};

function checkoutDeps(overrides: Partial<CreateCheckoutDeps> = {}): CreateCheckoutDeps {
  return {
    appUrl: "https://roomover.example",
    ownPlan: async (planId, buyerSession) => (planId === PLAN_ID && buyerSession === caller.buyerSession ? { id: PLAN_ID, running: false, hasUsedItems: true, held: null } : null),
    prepare: async () => ({ ok: true, order }),
    ...overrides,
  };
}

describe("create_checkout", () => {
  it("returns PayPal's approval link and records the order ID, and never approves anything itself", async () => {
    const outcome = await createCheckout(checkoutDeps(), caller, createCheckoutInput.parse({ planId: PLAN_ID }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data).toMatchObject({ paypalOrderId: "7YY18853U0064211D", approvalUrl: order.approvalUrl, previewUrl: `https://roomover.example/p/${PLAN_ID}`, total: "$107" });
    expect(outcome.data.whatHappens).toBe("After the student approves, PayPal holds $107 and charges each item when the student checks it at handoff. Sellers are paid out then. Nothing moves until the student approves in PayPal.");
    expect(outcome.record).toMatchObject({ planId: PLAN_ID, paypal: { api: "Orders v2", id: "7YY18853U0064211D" } });
    expect(outcome.record.sentence).toBe("Claude Code asked for a PayPal approval link for $107 over MCP. Nothing is charged until you approve in PayPal.");
  });

  it("finds only this session's plans", async () => {
    const other: McpCaller = { ...caller, buyerSession: "mcp-zzzzzzzzzzzzzzzzzzzz" };
    expect(await createCheckout(checkoutDeps(), other, { planId: PLAN_ID })).toMatchObject({
      ok: false,
      message: "No plan with that ID belongs to this MCP session. Call plan_room first and use the planId it returns.",
      record: { planId: null },
    });
  });

  it("waits for a running agent, refuses an empty room, and passes on why PayPal or checkout said no", async () => {
    expect(await createCheckout(checkoutDeps({ ownPlan: async () => ({ id: PLAN_ID, running: true, hasUsedItems: true, held: null }) }), caller, { planId: PLAN_ID })).toMatchObject({ ok: false, record: { planId: PLAN_ID } });
    expect(await createCheckout(checkoutDeps({ ownPlan: async () => ({ id: PLAN_ID, running: false, hasUsedItems: false, held: null }) }), caller, { planId: PLAN_ID })).toMatchObject({
      ok: false,
      message: "This room holds no used items, so there is nothing to pay for through PayPal.",
    });
    expect(await createCheckout(checkoutDeps({ prepare: async () => ({ ok: false, message: "This room is already paid for." }) }), caller, { planId: PLAN_ID })).toMatchObject({ ok: false, message: "This room is already paid for." });
    expect(await createCheckout(checkoutDeps({ prepare: async () => ({ ok: true, order: { ...order, approvalUrl: null } }) }), caller, { planId: PLAN_ID })).toMatchObject({ ok: false });
  });

  it("tells the assistant the room is paid once a student approved it, and never prepares another order", async () => {
    let prepared = false;
    const held = (settled: boolean) => checkoutDeps({ ownPlan: async () => ({ id: PLAN_ID, running: false, hasUsedItems: true, held: { totalCents: 10_200, settled } }), prepare: async () => ((prepared = true), { ok: true, order }) });
    expect(await createCheckout(held(false), caller, { planId: PLAN_ID })).toMatchObject({
      ok: false,
      message: "The student already approved this room in PayPal, so PayPal holds $102 until the handoff, which runs in the browser that approved it.",
      record: { planId: PLAN_ID },
    });
    expect(await createCheckout(held(true), caller, { planId: PLAN_ID })).toMatchObject({ ok: false, message: "The student already approved this room in PayPal and checked every item at handoff, so PayPal paid the sellers from the $102." });
    expect(prepared).toBe(false);
  });

  it("refuses an ID that is not a plan ID", () => {
    expect(createCheckoutInput.safeParse({ planId: "7YY18853U0064211D" }).success).toBe(false);
  });
});
