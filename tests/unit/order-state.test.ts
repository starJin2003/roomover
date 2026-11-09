import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, TERMINAL_ORDER_STATUSES } from "@/lib/domain/enums";
import { approvalFits, approvalStep, canTransition, holdsMoney, ITEM_STATUS_AFTER, planApproval } from "@/lib/domain/order-state";

describe("order state machine", () => {
  it("leaves pending approval once and never leaves a terminal state", () => {
    expect(canTransition("pending_approval", "authorized")).toBe(true);
    expect(canTransition("pending_approval", "captured")).toBe(true);
    expect(canTransition("authorized", "captured")).toBe(false);
    expect(canTransition("captured", "authorized")).toBe(false);
    expect(canTransition("capture_pending", "captured")).toBe(true);
    for (const terminal of TERMINAL_ORDER_STATUSES) {
      for (const next of ORDER_STATUSES) expect(canTransition(terminal, next)).toBe(false);
    }
  });

  it("calls the same result twice a duplicate and a result the order moved past stale", () => {
    expect(approvalStep("pending_approval", "authorized")).toBe("apply");
    expect(approvalStep("authorized", "authorized")).toBe("duplicate");
    expect(approvalStep("captured", "capture_pending")).toBe("stale");
    expect(approvalStep("canceled", "authorized")).toBe("stale");
  });

  it("only accepts results that match how the order pays", () => {
    expect(approvalFits("authorize_then_capture", "authorized")).toBe(true);
    expect(approvalFits("authorize_then_capture", "captured")).toBe(false);
    expect(approvalFits("capture_at_checkout", "captured")).toBe(true);
    expect(approvalFits("capture_at_checkout", "authorized")).toBe(false);
  });

  it("maps each result to the item status and says when money is held", () => {
    expect(ITEM_STATUS_AFTER.authorized).toBe("authorized");
    expect(ITEM_STATUS_AFTER.captured).toBe("held");
    expect(holdsMoney("authorized")).toBe(true);
    expect(holdsMoney("capture_declined")).toBe(false);
  });
});

describe("planApproval, the API answer and the webhook in either order", () => {
  const authorizeOrder = { status: "pending_approval" as const, paymentMode: "authorize_then_capture" as const };
  const captureOrder = { status: "pending_approval" as const, paymentMode: "capture_at_checkout" as const };

  it("applies the API answer and makes the later webhook a duplicate that reserves nothing", () => {
    expect(planApproval(authorizeOrder, "authorized")).toEqual({ step: "apply", reserveListings: true });
    expect(planApproval({ ...authorizeOrder, status: "authorized" }, "authorized")).toEqual({ step: "duplicate", reserveListings: false });
  });

  it("applies the webhook first and makes the later API answer a duplicate", () => {
    expect(planApproval(captureOrder, "captured")).toEqual({ step: "apply", reserveListings: true });
    expect(planApproval({ ...captureOrder, status: "captured" }, "captured")).toEqual({ step: "duplicate", reserveListings: false });
  });

  it("reserves listings at the pending capture and not again when it completes", () => {
    expect(planApproval(captureOrder, "capture_pending")).toEqual({ step: "apply", reserveListings: true });
    expect(planApproval({ ...captureOrder, status: "capture_pending" }, "captured")).toEqual({ step: "apply", reserveListings: false });
    expect(planApproval({ ...captureOrder, status: "captured" }, "capture_pending")).toEqual({ step: "stale", reserveListings: false });
  });

  it("ignores a result for the other payment mode and a declined capture reserves nothing", () => {
    expect(planApproval(authorizeOrder, "captured")).toEqual({ step: "stale", reserveListings: false });
    expect(planApproval(captureOrder, "capture_declined")).toEqual({ step: "apply", reserveListings: false });
  });
});
