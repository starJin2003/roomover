import { describe, expect, it } from "vitest";
import { gapDays, paymentModeFor, windowsOverlap, type MoveWindows } from "@/lib/domain/handoff";

const windows = (moveOut: [string, string], moveIn: [string, string]): MoveWindows => ({
  moveOutStartsAt: new Date(moveOut[0]),
  moveOutEndsAt: new Date(moveOut[1]),
  moveInStartsAt: new Date(moveIn[0]),
  moveInEndsAt: new Date(moveIn[1]),
});

const december = windows(["2026-12-11T08:00:00-06:00", "2026-12-12T12:00:00-06:00"], ["2027-01-02T09:00:00-06:00", "2027-01-04T18:00:00-06:00"]);
const overlapping = windows(["2026-12-14T09:00:00-06:00", "2027-01-05T20:00:00-06:00"], ["2027-01-02T09:00:00-06:00", "2027-01-04T18:00:00-06:00"]);
const summer = windows(["2027-06-12T09:00:00-05:00", "2027-06-14T12:00:00-05:00"], ["2027-09-17T09:00:00-05:00", "2027-09-20T18:00:00-05:00"]);

describe("move windows", () => {
  it("measures the gap from move out end to move in start", () => {
    expect(gapDays(december)).toBeCloseTo(20.875, 3);
    expect(gapDays(overlapping)).toBeLessThan(0);
    expect(gapDays(summer)).toBeGreaterThan(29);
  });

  it("detects overlap", () => {
    expect(windowsOverlap(overlapping)).toBe(true);
    expect(windowsOverlap(december)).toBe(false);
  });
});

describe("paymentModeFor", () => {
  it("authorizes a direct handoff only when both students are on campus together", () => {
    expect(paymentModeFor("direct", overlapping)).toBe("authorize_then_capture");
    expect(paymentModeFor("direct", december)).toBeNull();
  });

  it("authorizes a same room handoff within 29 days and captures at checkout after that", () => {
    expect(paymentModeFor("same_room", december)).toBe("authorize_then_capture");
    expect(paymentModeFor("same_room", summer)).toBe("capture_at_checkout");
    const exactly29 = windows(["2026-12-01T12:00:00Z", "2026-12-02T12:00:00Z"], ["2026-12-31T12:00:00Z", "2027-01-01T12:00:00Z"]);
    expect(paymentModeFor("same_room", exactly29)).toBe("authorize_then_capture");
  });

  it("always captures a storage hold at checkout", () => {
    expect(paymentModeFor("storage_hold", summer)).toBe("capture_at_checkout");
    expect(paymentModeFor("storage_hold", december)).toBe("capture_at_checkout");
  });
});
