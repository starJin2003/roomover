import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRecord, OrderWithLines } from "@/lib/db/orders";
import { PayPalApiError } from "@/lib/paypal/errors";

const db = vi.hoisted(() => ({
  order: null as OrderWithLines | null,
  listingStatus: "active" as string,
  records: [] as ApprovalRecord[],
  canceled: [] as string[],
  recordError: null as Error | null,
}));
const paypal = vi.hoisted(() => ({ calls: [] as { op: string; id: string; key?: string }[], answers: [] as (unknown | Error)[] }));

vi.mock("@/lib/db/orders", async (original) => {
  const actual = await original<typeof import("@/lib/db/orders")>();
  return {
    ...actual,
    orderByPayPalId: async () => db.order,
    loadCheckoutListings: async (_db: unknown, ids: string[]) => new Map(ids.map((id) => [id, { id, status: db.listingStatus }])),
    cancelPendingOrder: async (_db: unknown, id: string) => void db.canceled.push(id),
    recordApproval: async (_db: unknown, record: ApprovalRecord) => {
      if (db.recordError !== null) throw db.recordError;
      db.records.push(record);
      return db.order === null ? null : { order: { ...db.order, status: record.status }, step: "apply", events: [] };
    },
  };
});

function answer(op: string, id: string, key?: string) {
  paypal.calls.push({ op, id, key });
  const next = paypal.answers.shift();
  if (next instanceof Error) return Promise.reject(next);
  return Promise.resolve(next);
}

vi.mock("@/lib/paypal/server-sdk/orders", () => ({
  authorizeOrder: (_sdk: unknown, id: string, key: string) => answer("authorize", id, key),
  captureOrder: (_sdk: unknown, id: string, key: string) => answer("capture", id, key),
  getOrder: (_sdk: unknown, id: string) => answer("get", id),
}));
vi.mock("@/lib/paypal/server-sdk/payments", () => ({
  voidAuthorization: (_sdk: unknown, id: string, key: string) => answer("void", id, key),
  refundCapture: (_sdk: unknown, id: string, _input: unknown, key: string) => answer("refund", id, key),
}));

const { approveCheckout, CheckoutFailed } = await import("@/lib/checkout/approve");

const NOW = new Date("2026-11-09T15:00:00Z");
const deps = { db: {} as never, sdk: {} as never, appUrl: "http://127.0.0.1:3000", now: NOW };
const ORDER_ID = "9a2b8c3d-1111-4222-8333-444455556666";

function order(overrides: Partial<OrderWithLines> = {}): OrderWithLines {
  return {
    id: ORDER_ID,
    planId: "plan-1",
    buyerId: "jordan",
    paymentMode: "authorize_then_capture",
    status: "pending_approval",
    totalCents: 11_800,
    paypalOrderId: "5O190127TN364715T",
    paypalAuthorizationId: null,
    paypalCaptureId: null,
    authorizationExpiresAt: null,
    approvedAt: null,
    attempt: 1,
    createdAt: NOW,
    lines: [{ listingId: "lamp", sellerId: "ava", amountCents: 1_600, status: "pending" }],
    ...overrides,
  };
}

const authorized = { id: "5O190127TN364715T", status: "COMPLETED", purchaseUnits: [{ payments: { authorizations: [{ id: "0VF52814937998046", status: "CREATED", expirationTime: "2026-12-08T15:00:00Z" }] } }] };
const captured = (status = "COMPLETED") => ({ id: "5O190127TN364715T", status: "COMPLETED", purchaseUnits: [{ payments: { captures: [{ id: "2GG279541U471931P", status }] } }] });
const paypalError = (status: number, issue: string) => new PayPalApiError({ operation: "POST /v2/checkout/orders/{id}/authorize", status, errorName: "UNPROCESSABLE_ENTITY", message: issue, details: [{ issue }], debugId: "f7166095860d0" });
const approve = () => approveCheckout(deps, { planId: "plan-1", paypalOrderId: "5O190127TN364715T" });

beforeEach(() => {
  db.order = order();
  db.listingStatus = "active";
  db.records = [];
  db.canceled = [];
  db.recordError = null;
  paypal.calls = [];
  paypal.answers = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("approveCheckout", () => {
  it("authorizes an authorize mode order with a key derived from the order and records the authorization", async () => {
    paypal.answers = [authorized];
    const result = await approve();
    expect(paypal.calls).toEqual([{ op: "authorize", id: "5O190127TN364715T", key: `rmv.order-authorize.${ORDER_ID}.1` }]);
    expect(db.records).toEqual([
      { paypalOrderId: "5O190127TN364715T", status: "authorized", authorizationId: "0VF52814937998046", authorizationExpiresAt: new Date("2026-12-08T15:00:00Z"), source: "api", at: NOW },
    ]);
    expect(result.order.status).toBe("authorized");
  });

  it("captures a capture mode order and maps a pending or declined capture", async () => {
    db.order = order({ paymentMode: "capture_at_checkout" });
    paypal.answers = [captured()];
    await approve();
    expect(paypal.calls[0]).toEqual({ op: "capture", id: "5O190127TN364715T", key: `rmv.order-capture.${ORDER_ID}.1` });
    expect(db.records[0]).toMatchObject({ status: "captured", captureId: "2GG279541U471931P" });
    paypal.answers = [captured("PENDING")];
    await approve();
    expect(db.records[1].status).toBe("capture_pending");
    paypal.answers = [captured("DECLINED")];
    await approve();
    expect(db.records[2].status).toBe("capture_declined");
  });

  it("retries a 5xx once with the same key", async () => {
    paypal.answers = [paypalError(503, "SERVICE_UNAVAILABLE"), authorized];
    await approve();
    expect(paypal.calls.map((call) => call.key)).toEqual([`rmv.order-authorize.${ORDER_ID}.1`, `rmv.order-authorize.${ORDER_ID}.1`]);
  });

  it("returns an order a webhook already landed without calling PayPal", async () => {
    db.order = order({ status: "authorized", paypalAuthorizationId: "0VF52814937998046" });
    expect(await approve()).toMatchObject({ step: "duplicate" });
    expect(paypal.calls).toEqual([]);
  });

  it("recovers an order PayPal already authorized by reading it back", async () => {
    paypal.answers = [paypalError(422, "ORDER_ALREADY_AUTHORIZED"), authorized];
    await approve();
    expect(paypal.calls.map((call) => call.op)).toEqual(["authorize", "get"]);
    expect(db.records[0]).toMatchObject({ status: "authorized", authorizationId: "0VF52814937998046" });
  });

  it.each([
    ["INSTRUMENT_DECLINED", 422, "declined", true],
    ["ORDER_EXPIRED", 422, "expired", true],
    ["RESOURCE_NOT_FOUND", 404, "expired", true],
    ["ORDER_NOT_APPROVED", 422, "not_approved", false],
    ["INTERNAL_SERVICE_ERROR", 422, "failed", false],
  ])("turns %s into %s with one sentence and a way forward", async (issue, status, code, cancels) => {
    paypal.answers = [paypalError(status, issue)];
    const error = await approve().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CheckoutFailed);
    expect(error).toMatchObject({ code });
    expect((error as Error).message).toMatch(/\. (Press PayPal|Try again)/);
    expect(db.canceled).toEqual(cancels ? [ORDER_ID] : []);
    expect(db.records).toEqual([]);
  });

  it("refuses before PayPal when an item sold elsewhere, and cancels the order", async () => {
    db.listingStatus = "reserved";
    await expect(approve()).rejects.toMatchObject({ code: "taken" });
    expect(paypal.calls).toEqual([]);
    expect(db.canceled).toEqual([ORDER_ID]);
  });

  it("voids the new authorization when an item sold elsewhere while PayPal answered", async () => {
    const { ListingTaken } = await import("@/lib/db/orders");
    db.recordError = new ListingTaken(["lamp"]);
    paypal.answers = [authorized, {}];
    await expect(approve()).rejects.toMatchObject({ code: "taken" });
    expect(paypal.calls[1]).toEqual({ op: "void", id: "0VF52814937998046", key: `rmv.void.${ORDER_ID}.1` });
    expect(db.canceled).toEqual([ORDER_ID]);
  });

  it("answers not found for an order of another plan", async () => {
    db.order = order({ planId: "plan-2" });
    await expect(approve()).rejects.toMatchObject({ code: "not_found" });
  });
});
