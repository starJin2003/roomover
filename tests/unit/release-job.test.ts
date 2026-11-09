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
}

const state = vi.hoisted(() => ({
  orders: [] as FakeOrder[],
  calls: [] as { op: string; id: string; key: string }[],
  finished: [] as { id: string; planStatus: string }[],
  sentences: [] as string[],
  failVoid: false,
  cutoffs: [] as Date[],
}));

vi.mock("@/lib/agents/bus", () => ({ publish: () => undefined }));
vi.mock("@/lib/db/handoffs", () => ({
  cancelUnapprovedBefore: async (_db: unknown, createdBefore: Date) => {
    state.cutoffs.push(createdBefore);
    return ["expired-prepared"];
  },
  releaseCandidates: async (_db: unknown, approvedBefore: Date) =>
    state.orders.filter((order) => order.status === "releasing" || ((order.status === "authorized" || order.status === "captured") && order.approvedAt !== null && order.approvedAt <= approvedBefore)),
  claimRelease: async (_db: unknown, id: string) => {
    const order = state.orders.find((entry) => entry.id === id);
    if (order === undefined) return false;
    if (order.status === "releasing") return true;
    if (order.status !== "authorized" && order.status !== "captured") return false;
    order.status = "releasing";
    return true;
  },
  loadHandoffOrderById: async (_db: unknown, id: string) => {
    const order = state.orders.find((entry) => entry.id === id);
    return order === undefined
      ? null
      : { id, planId: "plan", paymentMode: order.paymentMode, totalCents: 14_400, attempt: 1, paypalAuthorizationId: "AUTH-" + id, paypalReauthorizationId: null, paypalCaptureId: "CAP-" + id, items: [1, 2, 3, 4, 5] };
  },
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

const { releaseOrder, releaseStaleOrders } = await import("@/lib/handoff/release");
const deps = { db: {} as never, sdk: {} as never, now: () => NOW };

beforeEach(() => {
  state.orders = [];
  state.calls = [];
  state.finished = [];
  state.sentences = [];
  state.failVoid = false;
  state.cutoffs = [];
});

describe("the hourly release job", () => {
  it("voids stale authorizations and refunds stale captures, and leaves everything else alone", async () => {
    state.orders = [
      { id: "old-auth", status: "authorized", paymentMode: "authorize_then_capture", approvedAt: new Date(NOW.getTime() - 3 * HOUR), photoCount: 0 },
      { id: "old-capture", status: "captured", paymentMode: "capture_at_checkout", approvedAt: new Date(NOW.getTime() - 2 * HOUR), photoCount: 0 },
      { id: "fresh", status: "authorized", paymentMode: "authorize_then_capture", approvedAt: new Date(NOW.getTime() - HOUR), photoCount: 0 },
      { id: "started", status: "authorized", paymentMode: "authorize_then_capture", approvedAt: new Date(NOW.getTime() - 5 * HOUR), photoCount: 2 },
      { id: "settling", status: "settling", paymentMode: "authorize_then_capture", approvedAt: new Date(NOW.getTime() - 5 * HOUR), photoCount: 5 },
      { id: "settled", status: "settled", paymentMode: "authorize_then_capture", approvedAt: new Date(NOW.getTime() - 9 * HOUR), photoCount: 5 },
    ];
    const report = await releaseStaleOrders(deps);
    expect(report).toEqual({ released: ["old-auth", "old-capture"], canceled: ["expired-prepared"], failed: [] });
    expect(state.cutoffs).toEqual([new Date(NOW.getTime() - 6 * HOUR)]);
    expect(state.calls).toEqual([
      { op: "void", id: "AUTH-old-auth", key: "rmv.void.old-auth.1" },
      { op: "refund", id: "CAP-old-capture", key: "rmv.refund.old-capture.1" },
    ]);
    expect(state.finished).toEqual([
      { id: "old-auth", planStatus: "ready" },
      { id: "old-capture", planStatus: "ready" },
    ]);
    expect(state.sentences).toEqual([
      "PayPal released your $144 hold, because no item was checked within 2 hours. Nothing was charged.",
      "Roomover refunded your $144, because no item was checked within 2 hours.",
    ]);
    expect(state.orders.map((order) => order.status)).toEqual(["voided", "refunded", "authorized", "authorized", "settling", "settled"]);
  });

  it("finishes a release a stopped run left partway, with the same key", async () => {
    state.orders = [{ id: "stuck", status: "releasing", paymentMode: "authorize_then_capture", approvedAt: new Date(NOW.getTime() - 9 * HOUR), photoCount: 0 }];
    expect((await releaseStaleOrders(deps)).released).toEqual(["stuck"]);
    expect(state.calls).toEqual([{ op: "void", id: "AUTH-stuck", key: "rmv.void.stuck.1" }]);
  });

  it("reports a PayPal failure, keeps the order releasing for the next run, and goes on with the rest", async () => {
    state.orders = [{ id: "bad", status: "authorized", paymentMode: "authorize_then_capture", approvedAt: new Date(NOW.getTime() - 3 * HOUR), photoCount: 0 }];
    state.failVoid = true;
    expect(await releaseStaleOrders(deps)).toEqual({ released: [], canceled: ["expired-prepared"], failed: [{ orderId: "bad", error: "422 AUTHORIZATION_EXPIRED" }] });
    expect(state.orders[0].status).toBe("releasing");
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
