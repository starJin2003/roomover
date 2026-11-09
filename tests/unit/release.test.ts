import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_HOLD_MS, releaseDue } from "@/lib/domain/release";
import { canTransition, releasedStatus } from "@/lib/domain/order-state";

const NOW = new Date("2026-11-09T18:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("the demo release guard", () => {
  it("releases an order holding money 2 hours after approval with no handoff photo", () => {
    expect(releaseDue({ status: "authorized", approvedAt: ago(DEMO_HOLD_MS), photoCount: 0 }, NOW)).toBe(true);
    expect(releaseDue({ status: "captured", approvedAt: ago(DEMO_HOLD_MS + 1), photoCount: 0 }, NOW)).toBe(true);
  });

  it("waits until the 2 hours pass", () => {
    expect(releaseDue({ status: "authorized", approvedAt: ago(DEMO_HOLD_MS - 1), photoCount: 0 }, NOW)).toBe(false);
  });

  it("never touches an order whose handoff started", () => {
    expect(releaseDue({ status: "authorized", approvedAt: ago(10 * DEMO_HOLD_MS), photoCount: 1 }, NOW)).toBe(false);
  });

  it("leaves orders that are settling, settled, released, unpaid, or pending alone", () => {
    for (const status of ["settling", "settled", "releasing", "voided", "refunded", "pending_approval", "canceled", "capture_pending", "capture_declined"] as const) {
      expect(releaseDue({ status, approvedAt: ago(10 * DEMO_HOLD_MS), photoCount: 0 }, NOW)).toBe(false);
    }
    expect(releaseDue({ status: "authorized", approvedAt: null, photoCount: 0 }, NOW)).toBe(false);
  });

  it("ends a release voided in authorize mode and refunded in capture mode, and a settlement cannot be released", () => {
    expect(releasedStatus("authorize_then_capture")).toBe("voided");
    expect(releasedStatus("capture_at_checkout")).toBe("refunded");
    expect(canTransition("authorized", "releasing")).toBe(true);
    expect(canTransition("captured", "releasing")).toBe(true);
    expect(canTransition("settling", "releasing")).toBe(false);
    expect(canTransition("releasing", "settling")).toBe(false);
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
