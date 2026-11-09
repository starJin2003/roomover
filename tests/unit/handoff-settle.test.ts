import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HandoffItem, HandoffOrder, PayoutRecord } from "@/lib/db/handoffs";
import type { PayoutItemStatus, PayoutStatus } from "@/lib/domain/enums";
import type { LayoutRef } from "@/lib/handoff/view";

/**
 * Settlement against an in-memory order. PayPal calls are recorded with
 * their idempotency keys, and the data layer keeps what each call returned,
 * so a second settle after a failure shows what a retry does.
 */

interface Call {
  op: string;
  id: string;
  key: string;
  amountCents?: number;
  finalCapture?: boolean;
}

const state = vi.hoisted(() => ({
  order: null as unknown as HandoffOrder,
  calls: [] as Call[],
  events: [] as { tool: string; sentence?: string }[],
  failCaptureOf: null as string | null,
  batchItems: [] as { senderItemId: string; amountCents: number; recipientType: string; receiver: string; note?: string }[],
  batches: 0,
  /** The seller who logged in with PayPal, so Roomover holds their payer ID. */
  payerIdSeller: null as string | null,
  relisted: 0,
  finished: false,
  error: null as string | null,
}));

function item(id: string, sellerId: string, sellerName: string, amountCents: number, payCents: number): HandoffItem {
  return {
    orderItemId: id,
    listingId: `listing-${id}`,
    sellerId,
    sellerName,
    title: `Item ${id}`,
    description: "",
    widthMm: 500,
    depthMm: 500,
    heightMm: 500,
    conditionReport: { grade: "good", notes: "Fine", defects: [], assessedBy: "seller" },
    photos: [{ src: `/seed/listings/${id}.jpg`, alt: id, widthPx: 100, heightPx: 100 }],
    listingStatus: "reserved",
    handoffMode: "direct",
    moveOutStartsAt: new Date(),
    moveOutEndsAt: new Date(),
    moveInStartsAt: new Date(),
    moveInEndsAt: new Date(),
    amountCents,
    capturedAmountCents: 0,
    refundedAmountCents: 0,
    status: "authorized",
    paypalCaptureId: null,
    paypalRefundId: null,
    slot: null,
    attempt: 1,
    handoff: {
      id: `handoff-${id}`,
      mode: "direct",
      status: "verified",
      slotStartsAt: new Date(),
      slotEndsAt: new Date(),
      location: "Harbor Hall 214",
      photos: [],
      report: id === "chair" ? { verdict: "new_damage", damage: { kind: "tear", location: "seat", sizeCm: 3, severity: "minor" }, confidence: "high", observations: "Tear.", model: "m", attempts: 1, comparedAt: new Date().toISOString() } : null,
      verifierError: null,
      decision: payCents === amountCents ? "accepted" : payCents === 0 ? "rejected" : "adjusted",
      payCents,
      decidedAt: new Date(),
    },
  };
}

function freshOrder(paymentMode: HandoffOrder["paymentMode"], items: HandoffItem[]): HandoffOrder {
  return {
    id: "6f9b2c1e-0d3a-4b5c-9e8f-1a2b3c4d5e6f",
    planId: "plan-1",
    sessionId: "session",
    paymentMode,
    status: paymentMode === "authorize_then_capture" ? "authorized" : "captured",
    totalCents: items.reduce((sum, entry) => sum + entry.amountCents, 0),
    paypalOrderId: "5O190127TN364715T",
    paypalAuthorizationId: paymentMode === "authorize_then_capture" ? "0VF52814937998046" : null,
    paypalReauthorizationId: null,
    paypalCaptureId: paymentMode === "capture_at_checkout" ? "2GG279541U471931P" : null,
    approvedAt: new Date(Date.now() - 60_000),
    reauthorizedAt: null,
    voidedAt: null,
    settledAt: null,
    releasedAt: null,
    settlementError: null,
    attempt: 1,
    items,
    payout: null,
  };
}

const clone = () => structuredClone(state.order);

vi.mock("@/lib/agents/bus", () => ({ publish: () => undefined }));
vi.mock("@/lib/db/handoffs", () => ({
  loadHandoffOrder: async () => clone(),
  loadHandoffOrderById: async () => clone(),
  claimSettlement: async () => {
    if (state.order.status === "settling") return true;
    if (state.order.status !== "authorized" && state.order.status !== "captured") return false;
    state.order.status = "settling";
    return true;
  },
  recordSettlementError: async (_db: unknown, _id: string, error: string | null) => {
    state.error = error;
    state.order.settlementError = error;
  },
  recordReauthorization: async (_db: unknown, _id: string, authorizationId: string, at: Date) => {
    state.order.paypalReauthorizationId = authorizationId;
    state.order.reauthorizedAt = at;
  },
  recordItemCapture: async (_db: unknown, input: { orderItemId: string; captureId: string; payCents: number }) => {
    const target = state.order.items.find((entry) => entry.orderItemId === input.orderItemId);
    if (target !== undefined) Object.assign(target, { paypalCaptureId: input.captureId, capturedAmountCents: input.payCents });
  },
  recordItemRefund: async (_db: unknown, input: { orderItemId: string; refundId: string; amountCents: number; payCents: number }) => {
    const target = state.order.items.find((entry) => entry.orderItemId === input.orderItemId);
    if (target !== undefined) Object.assign(target, { paypalRefundId: input.refundId, refundedAmountCents: input.amountCents - input.payCents });
  },
  recordVoided: async (_db: unknown, _id: string, at: Date) => {
    state.order.voidedAt = at;
  },
  insertHandoffEvents: async (_db: unknown, _order: unknown, _agent: unknown, drafts: { tool: string; sentence?: string }[]) => {
    state.events.push(...drafts.map((draft) => ({ tool: draft.tool, sentence: draft.sentence })));
    return [];
  },
  hasOrderEvent: async (_db: unknown, _id: string, tool: string) => state.events.some((event) => event.tool === tool),
  lockOrderPayout: async () => undefined,
  relistSeededListings: async () => {
    state.relisted += 1;
    return ["listing-desk"];
  },
  finishSettlement: async () => {
    state.order.status = "settled";
    state.finished = true;
  },
  sellerAccounts: async (_db: unknown, ids: string[]) =>
    new Map(ids.map((id) => [id, { paypalAccountId: id === state.payerIdSeller ? "PAYERID000001" : null, paypalEmail: `${id}@personal.example.com`, payoutWallet: "paypal", venmoHandle: null }])),
  insertPayout: async (_db: unknown, input: { senderBatchId: string; lines: { sellerId: string; amountCents: number; wallet: "paypal"; recipientType: "PAYPAL_ID" | "EMAIL"; receiver: string }[] }) => {
    if (state.order.payout !== null) return;
    const payout: PayoutRecord = {
      id: "payout-1",
      senderBatchId: input.senderBatchId,
      paypalBatchId: null,
      status: "created",
      totalCents: input.lines.reduce((sum, line) => sum + line.amountCents, 0),
      attempt: 1,
      createdAt: new Date(),
      items: input.lines.map((line) => ({ id: `pi-${line.sellerId}`, sellerId: line.sellerId, sellerName: line.sellerId, amountCents: line.amountCents, wallet: line.wallet, recipientType: line.recipientType, receiver: line.receiver, senderItemId: `pi-${line.sellerId}`, paypalPayoutItemId: null, status: "pending", statusChangedAt: null })),
    };
    state.order.payout = payout;
  },
  recordPayoutBatch: async (_db: unknown, _id: string, batchId: string) => {
    if (state.order.payout !== null) state.order.payout.paypalBatchId = batchId;
  },
  applyPayoutBatchStatus: async (_db: unknown, _match: unknown, next: PayoutStatus) => {
    if (state.order.payout !== null) state.order.payout.status = next;
    return { step: "apply", planId: "plan-1" };
  },
  applyPayoutItemStatus: async (_db: unknown, match: { senderItemId?: string; paypalPayoutItemId?: string }, next: PayoutItemStatus) => {
    const target = state.order.payout?.items.find((entry) => entry.senderItemId === match.senderItemId);
    if (target === undefined) return null;
    const step = target.status === next ? "duplicate" : "apply";
    Object.assign(target, { status: next, paypalPayoutItemId: match.paypalPayoutItemId ?? null });
    return { step, planId: "plan-1" };
  },
}));
vi.mock("@/lib/paypal/server-sdk/payments", () => ({
  captureAuthorization: async (_sdk: unknown, id: string, input: { amountCents: number; finalCapture: boolean }, key: string) => {
    state.calls.push({ op: "capture", id, key, amountCents: input.amountCents, finalCapture: input.finalCapture });
    if (state.failCaptureOf !== null && key.includes(state.failCaptureOf)) {
      const { PayPalApiError } = await import("@/lib/paypal/errors");
      throw new PayPalApiError({ operation: "capture", status: 422, errorName: "UNPROCESSABLE_ENTITY", message: "Declined", details: [{ issue: "INSTRUMENT_DECLINED" }], debugId: undefined });
    }
    return { id: `CAP-${key.split(".")[2].slice(0, 5)}`, status: "COMPLETED" };
  },
  voidAuthorization: async (_sdk: unknown, id: string, key: string) => {
    state.calls.push({ op: "void", id, key });
    return null;
  },
  refundCapture: async (_sdk: unknown, id: string, input: { amountCents?: number }, key: string) => {
    state.calls.push({ op: "refund", id, key, amountCents: input.amountCents });
    return { id: `REF-${key.split(".")[2].slice(0, 5)}`, status: "COMPLETED" };
  },
  reauthorizeAuthorization: async (_sdk: unknown, id: string, input: { amountCents?: number }, key: string) => {
    state.calls.push({ op: "reauthorize", id, key, amountCents: input.amountCents });
    return { id: "REAUTH1", status: "CREATED" };
  },
}));
vi.mock("@/lib/paypal/rest/payouts", () => ({
  createPayoutBatch: async (_rest: unknown, input: { items: { senderItemId: string; amountCents: number; recipientType: string; receiver: string; note?: string }[] }, key: string) => {
    state.batches += 1;
    state.batchItems = input.items;
    state.calls.push({ op: "payout", id: "", key });
    return { batch_header: { payout_batch_id: "YQPE4TRNPC52U", batch_status: "PENDING" } };
  },
  getPayoutBatch: async () => ({
    batch_header: { payout_batch_id: "YQPE4TRNPC52U", batch_status: "SUCCESS" },
    items: (state.order.payout?.items ?? []).map((entry, index) => ({ payout_item_id: `PI${index}`, transaction_status: "SUCCESS", payout_item: { sender_item_id: entry.senderItemId, amount: { currency: "USD", value: "1.00" } } })),
  }),
}));

const { settleHandoff, SettlementStopped } = await import("@/lib/handoff/settle");

const db = { transaction: async (run: (tx: unknown) => Promise<unknown>) => run(db) };
const deps = { db: db as never, sdk: {} as never, rest: {} as never, now: () => new Date() };
const layout = (ids: string[]) => new Map<string, LayoutRef>(ids.map((id, index) => [`listing-${id}`, { key: id, furnitureType: id === "chair" ? "desk_chair" : "desk", index }]));
const CART_IDS = ["desk", "chair", "lamp", "clamp", "bag"];
const cart = () => [item("desk", "jun", "Jun Park", 5_500, 5_500), item("chair", "marcus", "Marcus Bell", 3_500, 3_000), item("lamp", "ava", "Ava Lindqvist", 1_600, 1_600), item("clamp", "sofia", "Sofia Navarro", 800, 800), item("bag", "lea", "Lea Moreau", 3_000, 3_000)];

beforeEach(() => {
  state.calls = [];
  state.events = [];
  state.failCaptureOf = null;
  state.batchItems = [];
  state.batches = 0;
  state.finished = false;
  state.error = null;
  state.payerIdSeller = null;
  state.relisted = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("settleHandoff in authorize mode", () => {
  it("captures each kept item with its own key, marks the last one final, and pays every seller in one batch", async () => {
    state.order = freshOrder("authorize_then_capture", cart());
    state.payerIdSeller = "ava";
    await settleHandoff(deps, "plan-1", "Harbor Hall 214", layout(CART_IDS));
    const captures = state.calls.filter((call) => call.op === "capture");
    expect(captures.map((call) => [call.key, call.amountCents, call.finalCapture])).toEqual([
      ["rmv.capture.desk.1", 5_500, false],
      ["rmv.capture.chair.1", 3_000, false],
      ["rmv.capture.lamp.1", 1_600, false],
      ["rmv.capture.clamp.1", 800, false],
      ["rmv.capture.bag.1", 3_000, true],
    ]);
    expect(captures.every((call) => call.id === "0VF52814937998046")).toBe(true);
    expect(state.calls.some((call) => call.op === "void" || call.op === "refund")).toBe(false);
    expect(state.calls.filter((call) => call.op === "payout").map((call) => call.key)).toEqual(["rmv.payout.6f9b2c1e-0d3a-4b5c-9e8f-1a2b3c4d5e6f.1"]);
    // Ava logged in with PayPal, so her share goes to her payer ID. The others never did and get their sandbox email.
    expect(state.batchItems.map((entry) => [entry.recipientType, entry.receiver, entry.amountCents])).toEqual([
      ["EMAIL", "jun@personal.example.com", 5_500],
      ["EMAIL", "marcus@personal.example.com", 3_000],
      ["PAYPAL_ID", "PAYERID000001", 1_600],
      ["EMAIL", "sofia@personal.example.com", 800],
      ["EMAIL", "lea@personal.example.com", 3_000],
    ]);
    expect(state.batchItems[1].note).toBe("Roomover payment for Item chair, handed off in Harbor Hall 214.");
    expect(state.finished).toBe(true);
    expect(state.events.map((event) => event.sentence).filter(Boolean)).toEqual(["PayPal captured $139 for 5 items.", "You got $5 back for the chair's new tear.", "PayPal is paying 5 sellers $139 in one payout.", "Every seller got their share. $139 reached 5 PayPal accounts."]);
    // The moment every seller is paid, the seeded listings go back on sale for the next judge.
    expect(state.relisted).toBe(1);
  });

  it("voids the hold and pays nobody when every item is turned down", async () => {
    state.order = freshOrder("authorize_then_capture", [item("desk", "jun", "Jun Park", 5_500, 0), item("chair", "marcus", "Marcus Bell", 3_500, 0)]);
    await settleHandoff(deps, "plan-1", "Harbor Hall 214", layout(["desk", "chair"]));
    expect(state.calls).toEqual([{ op: "void", id: "0VF52814937998046", key: "rmv.void.6f9b2c1e-0d3a-4b5c-9e8f-1a2b3c4d5e6f.1" }]);
    expect(state.batches).toBe(0);
    expect(state.finished).toBe(true);
    expect(state.events.find((event) => event.tool === "void_authorization")?.sentence).toBe("PayPal released your $90 hold, so nothing was charged.");
  });

  it("stops at a declined capture with a sentence, and a retry captures only what is left with the same keys", async () => {
    state.order = freshOrder("authorize_then_capture", cart());
    state.failCaptureOf = "lamp";
    await expect(settleHandoff(deps, "plan-1", "Harbor Hall 214", layout(CART_IDS))).rejects.toBeInstanceOf(SettlementStopped);
    expect(state.order.status).toBe("settling");
    expect(state.error).toBe("PayPal did not finish settling your handoff. Nothing was charged twice. Press Try again.");
    expect(state.batches).toBe(0);

    state.failCaptureOf = null;
    state.calls = [];
    await settleHandoff(deps, "plan-1", "Harbor Hall 214", layout(CART_IDS));
    expect(state.calls.filter((call) => call.op === "capture").map((call) => [call.key, call.finalCapture])).toEqual([
      ["rmv.capture.lamp.1", false],
      ["rmv.capture.clamp.1", false],
      ["rmv.capture.bag.1", true],
    ]);
    expect(state.batches).toBe(1);
    expect(state.events.filter((event) => event.tool === "money_settled")).toHaveLength(1);
  });

  it("does nothing for an order that already settled, and sends a lost batch again with the same key", async () => {
    state.order = { ...freshOrder("authorize_then_capture", cart()), status: "settled" };
    await settleHandoff(deps, "plan-1", "Harbor Hall 214", layout(CART_IDS));
    expect(state.calls).toEqual([]);
  });

  it("reauthorizes once before capturing when the honor period has passed, and captures against the new authorization", async () => {
    state.order = { ...freshOrder("authorize_then_capture", cart()), approvedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) };
    await settleHandoff(deps, "plan-1", "Harbor Hall 214", layout(CART_IDS));
    expect(state.calls[0]).toEqual({ op: "reauthorize", id: "0VF52814937998046", key: "rmv.reauthorize.6f9b2c1e-0d3a-4b5c-9e8f-1a2b3c4d5e6f.1", amountCents: 13_900 });
    expect(state.calls.filter((call) => call.op === "capture").every((call) => call.id === "REAUTH1")).toBe(true);
  });
});

describe("settleHandoff in capture mode", () => {
  it("refunds the reduced and released amounts from the checkout capture, each with its item's key", async () => {
    state.order = freshOrder("capture_at_checkout", [item("desk", "jun", "Jun Park", 5_500, 5_500), item("chair", "marcus", "Marcus Bell", 3_500, 3_000), item("lamp", "ava", "Ava Lindqvist", 1_600, 0)]);
    await settleHandoff(deps, "plan-1", "Harbor Hall 214", layout(["desk", "chair", "lamp"]));
    expect(state.calls.filter((call) => call.op === "refund")).toEqual([
      { op: "refund", id: "2GG279541U471931P", key: "rmv.refund.chair.1", amountCents: 500 },
      { op: "refund", id: "2GG279541U471931P", key: "rmv.refund.lamp.1", amountCents: 1_600 },
    ]);
    expect(state.calls.some((call) => call.op === "capture" || call.op === "void")).toBe(false);
    expect(state.batchItems.map((entry) => entry.amountCents)).toEqual([5_500, 3_000]);
    expect(state.events.find((event) => event.tool === "money_settled")?.sentence).toBe("Roomover keeps $85 of your payment for 2 items.");
  });
});
