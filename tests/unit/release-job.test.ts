import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderStatus, PaymentMode } from "@/lib/domain/enums";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-11-09T18:00:00Z");

interface FakeOrder {
  id: string;
  status: OrderStatus;
  paymentMode: PaymentMode;
  approvedAt: Date | null;
  photoCount: number;
  lastActivityAt?: Date | null;
  attempt?: number;
  /** For a settling order, when it last changed. */
  changedAt?: Date;
  /** For a settling order, an item capture that already landed. */
  captured?: boolean;
}

const state = vi.hoisted(() => ({
  orders: [] as FakeOrder[],
  calls: [] as { op: string; id: string; key: string }[],
  finished: [] as { id: string; planStatus: string }[],
  sentences: [] as string[],
  failVoid: false,
  cutoffs: [] as Date[],
  sellListings: [] as { id: string; createdAt: Date; inOpenOrder: boolean; referenced: boolean }[],
  removed: [] as { deleteIds: string[]; withdrawIds: string[]; draftsBefore: Date }[],
  settleFails: false,
  settled: [] as { planId: string; roomLabel: string }[],
}));

vi.mock("@/lib/agents/bus", () => ({ publish: () => undefined }));
vi.mock("@/lib/db/handoffs", () => ({
  cancelUnapprovedBefore: async (_db: unknown, createdBefore: Date) => {
    state.cutoffs.push(createdBefore);
    return ["expired-prepared"];
  },
  releaseCandidates: async (_db: unknown, approvedBefore: Date) =>
    state.orders
      .filter((order) => order.status === "releasing" || ((order.status === "authorized" || order.status === "captured") && order.approvedAt !== null && order.approvedAt <= approvedBefore))
      .map((order) => ({ ...order, lastActivityAt: order.lastActivityAt ?? null })),
  claimRelease: async (_db: unknown, id: string, options: { fromSettling?: boolean } = {}) => {
    const order = state.orders.find((entry) => entry.id === id);
    if (order === undefined) return false;
    if (order.status === "releasing") return true;
    if (order.status !== "authorized" && order.status !== "captured" && !(options.fromSettling === true && order.status === "settling")) return false;
    order.status = "releasing";
    return true;
  },
  loadHandoffOrderById: async (_db: unknown, id: string) => {
    const order = state.orders.find((entry) => entry.id === id);
    return order === undefined
      ? null
      : {
          id,
          planId: "plan",
          paymentMode: order.paymentMode,
          totalCents: 14_400,
          attempt: order.attempt ?? 1,
          paypalAuthorizationId: "AUTH-" + id,
          paypalReauthorizationId: null,
          paypalCaptureId: order.paymentMode === "capture_at_checkout" ? "CAP-" + id : null,
          items: [1, 2, 3, 4, 5].map((n) => ({ paypalCaptureId: order.captured === true && n === 1 ? "ITEMCAP1" : null, paypalRefundId: null })),
          payout: null,
        };
  },
  nextOrderAttempt: async (_db: unknown, id: string, failed: number) => {
    const order = state.orders.find((entry) => entry.id === id);
    if (order !== undefined && (order.attempt ?? 1) === failed) order.attempt = failed + 1;
  },
  stoppedSettlements: async (_db: unknown, changedBefore: Date) =>
    state.orders.filter((order) => order.status === "settling" && order.changedAt !== undefined && order.changedAt < changedBefore).map((order) => ({ id: order.id, planId: `plan-${order.id}`, sessionId: "session" })),
  finishRelease: async (_db: unknown, id: string, input: { planStatus: string }) => {
    const order = state.orders.find((entry) => entry.id === id);
    if (order !== undefined) order.status = order.paymentMode === "authorize_then_capture" ? "voided" : "refunded";
    state.finished.push({ id, planStatus: input.planStatus });
  },
  insertHandoffEvents: async (_db: unknown, _order: unknown, _agent: unknown, drafts: { sentence?: string }[]) => {
    state.sentences.push(...drafts.flatMap((draft) => (draft.sentence === undefined ? [] : [draft.sentence])));
    return [];
  },
}));
vi.mock("@/lib/db/sell", () => ({
  sellListingsBefore: async () => state.sellListings,
  removeSellListings: async (_db: unknown, input: { deleteIds: string[]; withdrawIds: string[]; draftsBefore: Date }) => {
    state.removed.push(input);
    return { deleted: input.deleteIds.length, withdrawn: input.withdrawIds.length, drafts: 0, photos: 0 };
  },
}));
vi.mock("@/lib/paypal/server-sdk/payments", () => ({
  voidAuthorization: async (_sdk: unknown, id: string, key: string) => {
    state.calls.push({ op: "void", id, key });
    if (state.failVoid) {
      const { PayPalApiError } = await import("@/lib/paypal/errors");
      throw new PayPalApiError({ operation: "void", status: 422, errorName: "UNPROCESSABLE_ENTITY", message: "No", details: [{ issue: "AUTHORIZATION_EXPIRED" }], debugId: undefined });
    }
    return null;
  },
  refundCapture: async (_sdk: unknown, id: string, _input: unknown, key: string) => {
    state.calls.push({ op: "refund", id, key });
    return { id: "REFUND-" + id, status: "COMPLETED" };
  },
}));

vi.mock("@/lib/agents/buyer/run", () => ({ roomLabel: (preset: { hallName: string }, room: string | null) => `${preset.hallName} ${room}` }));
vi.mock("@/lib/db/plans", () => ({ loadSessionPlan: async (_db: unknown, planId: string) => ({ id: planId, roomNumber: "214", layout: { items: [] } }) }));
vi.mock("@/lib/handoff/load", () => ({ presetFor: async () => ({ hallName: "Harbor Hall" }), layoutRefs: () => new Map() }));
vi.mock("@/lib/handoff/settle", () => ({
  settleHandoff: async (_deps: unknown, planId: string, roomLabel: string) => {
    state.settled.push({ planId, roomLabel });
    if (state.settleFails) throw new Error("SettlementStopped");
    const order = state.orders.find((entry) => `plan-${entry.id}` === planId);
    if (order !== undefined) order.status = "settled";
  },
}));

const { releaseOrder, releaseStaleOrders } = await import("@/lib/handoff/release");
const deps = { db: {} as never, sdk: {} as never, rest: {} as never, now: () => NOW };

beforeEach(() => {
  state.orders = [];
  state.calls = [];
  state.finished = [];
  state.sentences = [];
  state.failVoid = false;
  state.cutoffs = [];
  state.sellListings = [];
  state.removed = [];
  state.settleFails = false;
  state.settled = [];
});

const NO_SELL = { deleted: 0, withdrawn: 0, drafts: 0, photos: 0 };

describe("the hourly release job", () => {
  it("voids stale authorizations and refunds stale captures, and leaves everything else alone", async () => {
    state.orders = [
      { id: "old-auth", status: "authorized", paymentMode: "authorize_then_capture", approvedAt: new Date(NOW.getTime() - 3 * HOUR), photoCount: 0 },
      { id: "old-capture", status: "captured", paymentMode: "capture_at_checkout", approvedAt: new Date(NOW.getTime() - 2 * HOUR), photoCount: 0 },
      { id: "fresh", status: "authorized", paymentMode: "authorize_then_capture", approvedAt: new Date(NOW.getTime() - HOUR), photoCount: 0 },
      { id: "started", status: "authorized", paymentMode: "authorize_then_capture", approvedAt: new Date(NOW.getTime() - 9 * HOUR), photoCount: 2, lastActivityAt: new Date(NOW.getTime() - 5 * HOUR) },
      { id: "idle", status: "authorized", paymentMode: "authorize_then_capture", approvedAt: new Date(NOW.getTime() - 9 * HOUR), photoCount: 3, lastActivityAt: new Date(NOW.getTime() - 6 * HOUR) },
      { id: "settling", status: "settling", paymentMode: "authorize_then_capture", approvedAt: new Date(NOW.getTime() - 5 * HOUR), photoCount: 5 },
      { id: "settled", status: "settled", paymentMode: "authorize_then_capture", approvedAt: new Date(NOW.getTime() - 9 * HOUR), photoCount: 5 },
    ];
    const report = await releaseStaleOrders(deps);
    expect(report).toEqual({
      released: [
        { orderId: "old-auth", reason: "demo_hold" },
        { orderId: "old-capture", reason: "demo_hold" },
        { orderId: "idle", reason: "idle_handoff" },
      ],
      resumed: [],
      canceled: ["expired-prepared"],
      sell: NO_SELL,
      failed: [],
    });
    expect(state.cutoffs).toEqual([new Date(NOW.getTime() - 6 * HOUR)]);
    expect(state.calls).toEqual([
      { op: "void", id: "AUTH-old-auth", key: "rmv.void.old-auth.1" },
      { op: "refund", id: "CAP-old-capture", key: "rmv.refund.old-capture.1" },
      { op: "void", id: "AUTH-idle", key: "rmv.void.idle.1" },
    ]);
    expect(state.finished).toEqual([
      { id: "old-auth", planStatus: "ready" },
      { id: "old-capture", planStatus: "ready" },
      { id: "idle", planStatus: "ready" },
    ]);
    expect(state.sentences).toEqual([
      "PayPal released your $144 hold, because no item was checked within 2 hours. Nothing was charged.",
      "Roomover refunded your $144, because no item was checked within 2 hours.",
      "PayPal released your $144 hold, because the handoff saw no activity for 6 hours. Nothing was charged.",
    ]);
    expect(state.orders.map((order) => order.status)).toEqual(["voided", "refunded", "authorized", "authorized", "voided", "settling", "settled"]);
  });

  it("finishes a release a stopped run left partway, with the same key", async () => {
    state.orders = [{ id: "stuck", status: "releasing", paymentMode: "authorize_then_capture", approvedAt: new Date(NOW.getTime() - 9 * HOUR), photoCount: 0 }];
    expect((await releaseStaleOrders(deps)).released).toEqual([{ orderId: "stuck", reason: "demo_hold" }]);
    expect(state.calls).toEqual([{ op: "void", id: "AUTH-stuck", key: "rmv.void.stuck.1" }]);
  });

  it("reports a PayPal refusal, keeps the order releasing, and sends the next attempt's key on the next run", async () => {
    state.orders = [{ id: "bad", status: "authorized", paymentMode: "authorize_then_capture", approvedAt: new Date(NOW.getTime() - 3 * HOUR), photoCount: 0 }];
    state.failVoid = true;
    expect(await releaseStaleOrders(deps)).toEqual({ released: [], resumed: [], canceled: ["expired-prepared"], sell: NO_SELL, failed: [{ orderId: "bad", error: "422 AUTHORIZATION_EXPIRED" }] });
    expect(state.orders[0].status).toBe("releasing");

    state.failVoid = false;
    await releaseStaleOrders(deps);
    expect(state.calls.map((call) => call.key)).toEqual(["rmv.void.bad.1", "rmv.void.bad.2"]);
    expect(state.orders[0].status).toBe("voided");
  });
});

describe("settlements that stopped", () => {
  const settling = (id: string, changedAgo: number, extra: Partial<FakeOrder> = {}): FakeOrder => ({ id, status: "settling", paymentMode: "authorize_then_capture", approvedAt: new Date(NOW.getTime() - 9 * HOUR), photoCount: 5, changedAt: new Date(NOW.getTime() - changedAgo), ...extra });

  it("carries on a settlement that saw no change for an hour, and leaves a younger one to the student", async () => {
    state.orders = [settling("stopped", HOUR + 1), settling("recent", HOUR - 1)];
    const report = await releaseStaleOrders(deps);
    expect(report.resumed).toEqual(["stopped"]);
    expect(state.settled).toEqual([{ planId: "plan-stopped", roomLabel: "Harbor Hall 214" }]);
    expect(state.orders.map((order) => order.status)).toEqual(["settled", "settling"]);
    expect(state.calls).toEqual([]);
  });

  it("releases a stopped settlement in full when carrying on fails before any money moved", async () => {
    state.orders = [settling("never-moved", 2 * HOUR), settling("refund-mode", 2 * HOUR, { paymentMode: "capture_at_checkout" })];
    state.settleFails = true;
    const report = await releaseStaleOrders(deps);
    expect(report.released).toEqual([
      { orderId: "never-moved", reason: "stopped_settlement" },
      { orderId: "refund-mode", reason: "stopped_settlement" },
    ]);
    expect(state.calls).toEqual([
      { op: "void", id: "AUTH-never-moved", key: "rmv.void.never-moved.1" },
      { op: "refund", id: "CAP-refund-mode", key: "rmv.refund.refund-mode.1" },
    ]);
    expect(state.sentences).toEqual([
      "PayPal released your $144 hold, because the handoff could not settle within an hour. Nothing was charged.",
      "Roomover refunded your $144, because the handoff could not settle within an hour.",
    ]);
    expect(state.finished).toEqual([
      { id: "never-moved", planStatus: "ready" },
      { id: "refund-mode", planStatus: "ready" },
    ]);
  });

  it("keeps a stopped settlement that already captured an item settling for the next run", async () => {
    state.orders = [settling("half-done", 2 * HOUR, { captured: true })];
    state.settleFails = true;
    const report = await releaseStaleOrders(deps);
    expect(report.released).toEqual([]);
    expect(report.failed).toEqual([{ orderId: "half-done", error: "Error" }]);
    expect(state.calls).toEqual([]);
    expect(state.orders[0].status).toBe("settling");
  });
});

describe("Sell cleanup in the hourly job", () => {
  it("deletes day old Sell listings nothing names, withdraws named ones, and keeps those in open orders", async () => {
    state.sellListings = [
      { id: "plain", createdAt: new Date(NOW.getTime() - 25 * HOUR), inOpenOrder: false, referenced: false },
      { id: "in-history", createdAt: new Date(NOW.getTime() - 30 * HOUR), inOpenOrder: false, referenced: true },
      { id: "being-bought", createdAt: new Date(NOW.getTime() - 30 * HOUR), inOpenOrder: true, referenced: true },
    ];
    const report = await releaseStaleOrders(deps);
    expect(state.removed).toEqual([{ deleteIds: ["plain"], withdrawIds: ["in-history"], draftsBefore: new Date(NOW.getTime() - 24 * HOUR) }]);
    expect(report.sell).toEqual({ deleted: 1, withdrawn: 1, drafts: 0, photos: 0 });
  });
});

describe("a new plan on a paid room", () => {
  it("releases the hold at once and leaves the old plan abandoned", async () => {
    state.orders = [{ id: "paid", status: "authorized", paymentMode: "authorize_then_capture", approvedAt: new Date(NOW.getTime() - 60_000), photoCount: 3 }];
    expect(await releaseOrder(deps, "paid", "new_plan")).toBe(true);
    expect(state.finished).toEqual([{ id: "paid", planStatus: "abandoned" }]);
    expect(state.sentences).toEqual(["You started a new plan, so PayPal released your $144 hold. Nothing was charged."]);
  });

  it("refuses an order that is settling or settled", async () => {
    state.orders = [{ id: "busy", status: "settling", paymentMode: "authorize_then_capture", approvedAt: NOW, photoCount: 5 }];
    expect(await releaseOrder(deps, "busy", "new_plan")).toBe(false);
    expect(state.calls).toEqual([]);
  });
});
