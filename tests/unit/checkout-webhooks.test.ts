import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRecord } from "@/lib/db/orders";
import type { PayPalWebhookEvent } from "@/lib/paypal/webhooks/events";

const state = vi.hoisted(() => ({ records: [] as ApprovalRecord[], result: "apply" as "apply" | "duplicate" | "missing" | "taken", published: [] as unknown[], itemCaptures: [] as string[] }));

vi.mock("@/lib/db/orders", async (original) => {
  const actual = await original<typeof import("@/lib/db/orders")>();
  return {
    ...actual,
    recordApproval: async (_db: unknown, record: ApprovalRecord) => {
      state.records.push(record);
      if (state.result === "missing") return null;
      if (state.result === "taken") throw new actual.ListingTaken(["lamp"]);
      return { order: { id: "order-1", planId: "plan-1" }, step: state.result, events: state.result === "apply" ? [{ seq: 7 }] : [] };
    },
  };
});
vi.mock("@/lib/handoff/webhooks", () => ({ onItemCaptureCompleted: async (event: PayPalWebhookEvent) => void state.itemCaptures.push(event.resource.id as string) }));
vi.mock("@/lib/agents/bus", () => ({ publish: (planId: string, message: unknown) => state.published.push([planId, message]) }));

const { onAuthorizationCreated, onCaptureCompleted } = await import("@/lib/checkout/webhooks");

const event = (type: string, resource: Record<string, unknown>): PayPalWebhookEvent => ({ id: "WH-2BK72316VD8812512-6LV52467FM3226633", event_type: type, create_time: "2026-11-09T15:00:05Z", resource });
const authorization = { id: "0VF52814937998046", status: "CREATED", expiration_time: "2026-12-08T15:00:00Z", supplementary_data: { related_ids: { order_id: "5O190127TN364715T" } } };

beforeEach(() => {
  state.records = [];
  state.result = "apply";
  state.published = [];
  state.itemCaptures = [];
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("checkout webhooks", () => {
  it("lands PAYMENT.AUTHORIZATION.CREATED through recordApproval with the related order", async () => {
    await onAuthorizationCreated(event("PAYMENT.AUTHORIZATION.CREATED", authorization), {} as never);
    expect(state.records).toEqual([
      {
        paypalOrderId: "5O190127TN364715T",
        status: "authorized",
        authorizationId: "0VF52814937998046",
        authorizationExpiresAt: new Date("2026-12-08T15:00:00Z"),
        source: "webhook",
        at: new Date("2026-11-09T15:00:05Z"),
      },
    ]);
    expect(state.published).toEqual([["plan-1", { type: "event", event: { seq: 7 } }]]);
  });

  it("changes nothing and publishes nothing when the API path got there first", async () => {
    state.result = "duplicate";
    await onAuthorizationCreated(event("PAYMENT.AUTHORIZATION.CREATED", authorization), {} as never);
    expect(state.published).toEqual([]);
    expect(console.info).toHaveBeenCalledWith("paypal webhook checkout", expect.objectContaining({ step: "duplicate" }));
  });

  it("lands a capture at checkout and hands captures of an authorization to handoff", async () => {
    await onCaptureCompleted(event("PAYMENT.CAPTURE.COMPLETED", { id: "2GG279541U471931P", status: "COMPLETED", supplementary_data: { related_ids: { order_id: "5O190127TN364715T" } } }), {} as never);
    expect(state.records[0]).toMatchObject({ status: "captured", captureId: "2GG279541U471931P", source: "webhook" });
    await onCaptureCompleted(
      event("PAYMENT.CAPTURE.COMPLETED", { id: "3C679366HH908993F", supplementary_data: { related_ids: { order_id: "5O190127TN364715T", authorization_id: "0VF52814937998046" } } }),
      {} as never,
    );
    expect(state.records).toHaveLength(1);
    expect(state.itemCaptures).toEqual(["3C679366HH908993F"]);
  });

  it("acknowledges an unknown order, an event without an order, and an item taken elsewhere without throwing", async () => {
    state.result = "missing";
    await expect(onAuthorizationCreated(event("PAYMENT.AUTHORIZATION.CREATED", authorization), {} as never)).resolves.toBeUndefined();
    await expect(onAuthorizationCreated(event("PAYMENT.AUTHORIZATION.CREATED", { id: "0VF52814937998046" }), {} as never)).resolves.toBeUndefined();
    state.result = "taken";
    await expect(onAuthorizationCreated(event("PAYMENT.AUTHORIZATION.CREATED", authorization), {} as never)).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith("paypal webhook found a listing taken", expect.objectContaining({ listingIds: ["lamp"] }));
  });
});
