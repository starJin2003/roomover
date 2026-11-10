import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_HOLD_MS, IDLE_HANDOFF_MS, releaseReason, SELL_LISTING_TTL_MS, sellListingCleanup, settlementMovedMoney, STOPPED_SETTLEMENT_MS } from "@/lib/domain/release";
import type { OrderStatus } from "@/lib/domain/enums";
import { canTransition, releasedStatus } from "@/lib/domain/order-state";

const NOW = new Date("2026-11-09T18:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("the demo release guard", () => {
  const order = (status: OrderStatus, approvedAt: Date | null, photoCount = 0, lastActivityAt: Date | null = null) => ({ status, approvedAt, photoCount, lastActivityAt });

  it("releases an order holding money 2 hours after approval with no handoff photo", () => {
    expect(releaseReason(order("authorized", ago(DEMO_HOLD_MS)), NOW)).toBe("demo_hold");
    expect(releaseReason(order("captured", ago(DEMO_HOLD_MS + 1)), NOW)).toBe("demo_hold");
  });

  it("waits until the 2 hours pass", () => {
    expect(releaseReason(order("authorized", ago(DEMO_HOLD_MS - 1)), NOW)).toBeNull();
  });

  it("releases a handoff that started and then saw no activity for 6 hours, and keeps one still in use", () => {
    expect(releaseReason(order("authorized", ago(10 * DEMO_HOLD_MS), 2, ago(IDLE_HANDOFF_MS)), NOW)).toBe("idle_handoff");
    expect(releaseReason(order("captured", ago(10 * DEMO_HOLD_MS), 1, ago(IDLE_HANDOFF_MS + 1)), NOW)).toBe("idle_handoff");
    expect(releaseReason(order("authorized", ago(10 * DEMO_HOLD_MS), 2, ago(IDLE_HANDOFF_MS - 1)), NOW)).toBeNull();
    // Without a recorded activity time, the approval counts as the last activity.
    expect(releaseReason(order("authorized", ago(IDLE_HANDOFF_MS), 1, null), NOW)).toBe("idle_handoff");
  });

  it("leaves orders that are settling, settled, released, unpaid, or pending alone", () => {
    for (const status of ["settling", "settled", "releasing", "voided", "refunded", "pending_approval", "canceled", "capture_pending", "capture_declined"] as const) {
      expect(releaseReason(order(status, ago(10 * DEMO_HOLD_MS), 0), NOW)).toBeNull();
      expect(releaseReason(order(status, ago(10 * DEMO_HOLD_MS), 3, ago(10 * IDLE_HANDOFF_MS)), NOW)).toBeNull();
    }
    expect(releaseReason(order("authorized", null), NOW)).toBeNull();
  });

  it("ends a release voided in authorize mode and refunded in capture mode, and only a stopped settlement can turn into a release", () => {
    expect(releasedStatus("authorize_then_capture")).toBe("voided");
    expect(releasedStatus("capture_at_checkout")).toBe("refunded");
    expect(canTransition("authorized", "releasing")).toBe(true);
    expect(canTransition("captured", "releasing")).toBe(true);
    expect(canTransition("settling", "releasing")).toBe(true);
    expect(canTransition("releasing", "settling")).toBe(false);
    expect(canTransition("settled", "releasing")).toBe(false);
  });

  it("says a settlement moved money once an item was captured or refunded or a payout batch exists", () => {
    const item = (paypalCaptureId: string | null = null, paypalRefundId: string | null = null) => ({ paypalCaptureId, paypalRefundId });
    expect(settlementMovedMoney({ items: [item(), item()], payout: null })).toBe(false);
    expect(settlementMovedMoney({ items: [item(), item()], payout: { paypalBatchId: null } })).toBe(false);
    expect(settlementMovedMoney({ items: [item("CAP1"), item()], payout: null })).toBe(true);
    expect(settlementMovedMoney({ items: [item(null, "REF1")], payout: null })).toBe(true);
    expect(settlementMovedMoney({ items: [item()], payout: { paypalBatchId: "YQPE4TRNPC52U" } })).toBe(true);
    expect(STOPPED_SETTLEMENT_MS).toBe(60 * 60 * 1000);
  });
});

describe("Sell listing cleanup", () => {
  const listing = (ageMs: number, inOpenOrder = false, referenced = false) => ({ createdAt: ago(ageMs), inOpenOrder, referenced });

  it("deletes a day old listing nothing names, and withdraws one an order or a plan still names", () => {
    expect(sellListingCleanup(listing(SELL_LISTING_TTL_MS), NOW)).toBe("delete");
    expect(sellListingCleanup(listing(SELL_LISTING_TTL_MS + 1, false, true), NOW)).toBe("withdraw");
  });

  it("keeps a listing younger than a day, and any listing an open order names", () => {
    expect(sellListingCleanup(listing(SELL_LISTING_TTL_MS - 1), NOW)).toBe("keep");
    expect(sellListingCleanup(listing(10 * SELL_LISTING_TTL_MS, true, true), NOW)).toBe("keep");
  });
});

describe("the hourly release cron job in render.yaml", () => {
  const blueprint = readFileSync("render.yaml", "utf8");
  const job = blueprint.slice(blueprint.indexOf("- type: cron\n    name: roomover-release"), blueprint.indexOf("databases:"));

  it("runs every hour on the hour with the release script", () => {
    expect(job).toContain("type: cron");
    expect(job).toContain('schedule: "0 * * * *"');
    expect(job).toContain("startCommand: npm run orders:release");
    expect(JSON.parse(readFileSync("package.json", "utf8")).scripts["orders:release"]).toBe("tsx --env-file-if-exists=.env.local scripts/orders/release.ts");
  });

  it("reads the database privately and copies the PayPal credentials from the web service", () => {
    expect(job).toMatch(/key: DATABASE_URL\s+fromDatabase:\s+name: roomover-db\s+property: connectionString/);
    for (const key of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]) {
      expect(job).toMatch(new RegExp(`key: ${key}\\s+fromService:\\s+name: roomover\\s+type: web\\s+envVarKey: ${key}`));
    }
    expect(job).not.toContain("sync: false");
  });
});
