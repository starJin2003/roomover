import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ landed: [] as string[], followed: [] as string[] }));

vi.mock("@/lib/disputes/webhooks", () => ({
  onDisputeEvent: async (event: { id: string }) => void calls.landed.push(event.id),
  afterDisputeEvent: async (event: { id: string }) => void calls.followed.push(event.id),
}));

const { dispatchWebhookEvent, followUpWebhookEvent } = await import("@/lib/paypal/webhooks/dispatch");

const event = (type: string, id: string) => ({ id, event_type: type, create_time: "2026-11-09T20:05:00Z", resource: { dispute_id: "PP-D-27803" } });

beforeEach(() => {
  calls.landed = [];
  calls.followed = [];
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("dispute webhooks", () => {
  it("lands every dispute event inside the stored event's transaction", async () => {
    for (const type of ["CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED"]) {
      expect(await dispatchWebhookEvent(event(type, `WH-${type}`), {} as never)).toBe(true);
    }
    expect(calls.landed).toEqual(["WH-CUSTOMER.DISPUTE.CREATED", "WH-CUSTOMER.DISPUTE.UPDATED", "WH-CUSTOMER.DISPUTE.RESOLVED"]);
    expect(calls.followed).toEqual([]);
  });

  it("starts the verifier's dispute run only after commit, and only for dispute events", async () => {
    await followUpWebhookEvent(event("CUSTOMER.DISPUTE.UPDATED", "WH-2"));
    expect(followUpWebhookEvent(event("PAYMENT.CAPTURE.COMPLETED", "WH-3"))).toBeNull();
    expect(calls.followed).toEqual(["WH-2"]);
  });
});
