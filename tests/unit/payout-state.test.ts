import { describe, expect, it } from "vitest";
import { PAYOUT_ITEM_STATUSES, type PayoutItemStatus } from "@/lib/domain/enums";
import { batchStatusFromPayPal, itemStatusFromPayPal, PAYOUT_ITEM_EVENT_STATUS, payoutBatchFinal, payoutBatchStep, payoutItemPaid, payoutItemStep, payoutItemWaiting } from "@/lib/domain/payout-state";
import { PAYPAL_WEBHOOK_EVENT_TYPES } from "@/lib/paypal/webhooks/events";

describe("payout item transitions", () => {
  it("moves a pending item to any status PayPal reports", () => {
    for (const next of PAYOUT_ITEM_STATUSES.filter((status) => status !== "pending")) expect(payoutItemStep("pending", next)).toBe("apply");
  });

  it("treats the same status twice as a duplicate", () => {
    for (const status of PAYOUT_ITEM_STATUSES) expect(payoutItemStep(status, status)).toBe("duplicate");
  });

  it("ignores reports older than what Roomover holds, such as a held event after success", () => {
    expect(payoutItemStep("succeeded", "held")).toBe("stale");
    expect(payoutItemStep("succeeded", "pending")).toBe("stale");
    expect(payoutItemStep("succeeded", "unclaimed")).toBe("stale");
    expect(payoutItemStep("failed", "succeeded")).toBe("stale");
    expect(payoutItemStep("returned", "unclaimed")).toBe("stale");
  });

  it("lets an unclaimed payout succeed when claimed or return after 30 days, and a paid one be refunded or reversed", () => {
    expect(payoutItemStep("unclaimed", "succeeded")).toBe("apply");
    expect(payoutItemStep("unclaimed", "returned")).toBe("apply");
    expect(payoutItemStep("held", "succeeded")).toBe("apply");
    expect(payoutItemStep("succeeded", "refunded")).toBe("apply");
    expect(payoutItemStep("succeeded", "reversed")).toBe("apply");
  });

  it("ends every terminal status", () => {
    const terminal: PayoutItemStatus[] = ["failed", "blocked", "canceled", "refunded", "returned", "reversed"];
    for (const from of terminal) for (const next of PAYOUT_ITEM_STATUSES) if (next !== from) expect(payoutItemStep(from, next)).toBe("stale");
  });
});

describe("payout statuses from PayPal", () => {
  it("maps every subscribed payout item webhook to a status", () => {
    const itemEvents = PAYPAL_WEBHOOK_EVENT_TYPES.filter((type) => type.startsWith("PAYMENT.PAYOUTS-ITEM."));
    expect(Object.keys(PAYOUT_ITEM_EVENT_STATUS).sort()).toEqual([...itemEvents].sort());
    expect(PAYOUT_ITEM_EVENT_STATUS["PAYMENT.PAYOUTS-ITEM.SUCCEEDED"]).toBe("succeeded");
    expect(PAYOUT_ITEM_EVENT_STATUS["PAYMENT.PAYOUTS-ITEM.UNCLAIMED"]).toBe("unclaimed");
  });

  it("reads transaction_status, with an unknown value as pending", () => {
    expect(itemStatusFromPayPal("SUCCESS")).toBe("succeeded");
    expect(itemStatusFromPayPal("ONHOLD")).toBe("held");
    expect(itemStatusFromPayPal("UNCLAIMED")).toBe("unclaimed");
    expect(itemStatusFromPayPal("NEW_STATUS")).toBe("pending");
    expect(itemStatusFromPayPal(undefined)).toBe("pending");
  });

  it("reads batch_status and moves a batch only forward", () => {
    expect(batchStatusFromPayPal("PENDING")).toBe("pending");
    expect(batchStatusFromPayPal("SUCCESS")).toBe("success");
    expect(batchStatusFromPayPal("SOMETHING")).toBe("processing");
    expect(payoutBatchStep("created", "pending")).toBe("apply");
    expect(payoutBatchStep("pending", "success")).toBe("apply");
    expect(payoutBatchStep("processing", "pending")).toBe("stale");
    expect(payoutBatchStep("success", "processing")).toBe("stale");
    expect(payoutBatchStep("success", "success")).toBe("duplicate");
    expect(payoutBatchStep("pending", "denied")).toBe("apply");
    expect(payoutBatchFinal("processing")).toBe(false);
    expect(payoutBatchFinal("success")).toBe(true);
    expect(payoutBatchFinal("denied")).toBe(true);
  });

  it("fills a seller row only on success and stops waiting for unclaimed payouts", () => {
    expect(payoutItemPaid("succeeded")).toBe(true);
    expect(payoutItemPaid("unclaimed")).toBe(false);
    expect(payoutItemWaiting("pending")).toBe(true);
    expect(payoutItemWaiting("held")).toBe(true);
    expect(payoutItemWaiting("unclaimed")).toBe(false);
  });
});
