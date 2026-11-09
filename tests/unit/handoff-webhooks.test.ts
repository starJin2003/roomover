import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PayPalWebhookEvent } from "@/lib/paypal/webhooks/events";

const state = vi.hoisted(() => ({
  items: [] as unknown[][],
  batches: [] as unknown[][],
  published: [] as unknown[][],
  released: [] as string[],
  orderStatus: "authorized" as string,
  step: "apply" as "apply" | "duplicate" | "stale",
  noted: [] as string[],
}));

vi.mock("@/lib/db/handoffs", () => ({
  applyPayoutItemStatus: async (_db: unknown, match: unknown, next: unknown) => {
    state.items.push([match, next]);
    return { step: state.step, planId: "plan-1", orderId: "order-1" };
  },
  applyPayoutBatchStatus: async (_db: unknown, match: unknown, next: unknown) => {
    state.batches.push([match, next]);
    return { step: state.step, planId: "plan-1", orderId: "order-1" };
  },
  confirmItemCapture: async () => "plan-1",
  orderByAuthorization: async () => ({ id: "order-1", planId: "plan-1", status: state.orderStatus }),
  finishRelease: async (_db: unknown, orderId: string) => void state.released.push(orderId),
}));
vi.mock("@/lib/agents/bus", () => ({ publish: (...args: unknown[]) => state.published.push(args) }));
vi.mock("@/lib/handoff/payouts", () => ({ notePayoutLanded: async (_db: unknown, orderId: string) => void state.noted.push(orderId) }));

const { onAuthorizationVoided, onPayoutBatchEvent, onPayoutItemEvent } = await import("@/lib/handoff/webhooks");

const event = (type: string, resource: Record<string, unknown>): PayPalWebhookEvent => ({ id: "WH-1", event_type: type, create_time: "2026-11-09T18:00:00Z", resource });
const db = { update: () => ({ set: () => ({ where: async () => undefined }) }) } as never;

beforeEach(() => {
  state.items = [];
  state.batches = [];
  state.published = [];
  state.released = [];
  state.orderStatus = "authorized";
  state.step = "apply";
  state.noted = [];
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("payout webhooks", () => {
  it("lands each payout item event by PayPal's ID and Roomover's sender_item_id, and tells the screen", async () => {
    const resource = { payout_item_id: "SBPQ2VLDDTMSC", transaction_status: "SUCCESS", payout_batch_id: "YQPE4TRNPC52U", payout_item: { sender_item_id: "a1b2" } };
    await onPayoutItemEvent(event("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", resource), db);
    await onPayoutItemEvent(event("PAYMENT.PAYOUTS-ITEM.UNCLAIMED", resource), db);
    await onPayoutItemEvent(event("PAYMENT.PAYOUTS-ITEM.FAILED", resource), db);
    expect(state.items).toEqual([
      [{ paypalPayoutItemId: "SBPQ2VLDDTMSC", senderItemId: "a1b2" }, "succeeded"],
      [{ paypalPayoutItemId: "SBPQ2VLDDTMSC", senderItemId: "a1b2" }, "unclaimed"],
      [{ paypalPayoutItemId: "SBPQ2VLDDTMSC", senderItemId: "a1b2" }, "failed"],
    ]);
    expect(state.published).toEqual([
      ["plan-1", { type: "handoff" }],
      ["plan-1", { type: "handoff" }],
      ["plan-1", { type: "handoff" }],
    ]);
    // Webhooks reach the deployed app alone, so each applied status checks whether every seller is now paid.
    expect(state.noted).toEqual(["order-1", "order-1", "order-1"]);
  });

  it("stays quiet on the screen for a repeated or stale event", async () => {
    state.step = "stale";
    await onPayoutItemEvent(event("PAYMENT.PAYOUTS-ITEM.HELD", { payout_item_id: "SBPQ2VLDDTMSC" }), db);
    expect(state.items).toHaveLength(1);
    expect(state.published).toEqual([]);
    expect(state.noted).toEqual([]);
  });

  it("acknowledges an item event without an ID", async () => {
    await expect(onPayoutItemEvent(event("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", {}), db)).resolves.toBeUndefined();
    expect(state.items).toEqual([]);
  });

  it("lands batch success and denial", async () => {
    await onPayoutBatchEvent(event("PAYMENT.PAYOUTSBATCH.SUCCESS", { batch_header: { payout_batch_id: "YQPE4TRNPC52U", batch_status: "SUCCESS", sender_batch_header: { sender_batch_id: "rmv.payout.order.1" } } }), db);
    await onPayoutBatchEvent(event("PAYMENT.PAYOUTSBATCH.DENIED", { batch_header: { payout_batch_id: "YQPE4TRNPC52U", batch_status: "DENIED" } }), db);
    expect(state.batches).toEqual([
      [{ paypalBatchId: "YQPE4TRNPC52U", senderBatchId: "rmv.payout.order.1" }, "success"],
      [{ paypalBatchId: "YQPE4TRNPC52U", senderBatchId: undefined }, "denied"],
    ]);
  });
});

describe("authorization voided", () => {
  it("releases an order still waiting for handoff when PayPal voids its authorization", async () => {
    await onAuthorizationVoided(event("PAYMENT.AUTHORIZATION.VOIDED", { id: "0VF52814937998046" }), db);
    expect(state.released).toEqual(["order-1"]);
  });

  it("leaves an order alone when Roomover voided it during settlement or a release", async () => {
    for (const status of ["settling", "settled", "releasing", "voided"]) {
      state.orderStatus = status;
      await onAuthorizationVoided(event("PAYMENT.AUTHORIZATION.VOIDED", { id: "0VF52814937998046" }), db);
    }
    expect(state.released).toEqual([]);
  });
});
