import { describe, expect, it } from "vitest";
import {
  DISPUTE_STATUS_DISPLAY,
  LISTING_STATUS_DISPLAY,
  orderItemStatusDisplay,
  PAYOUT_ITEM_STATUS_DISPLAY,
} from "@/lib/design/status";
import { DISPUTE_STATUSES, LISTING_STATUSES, ORDER_ITEM_STATUSES, PAYMENT_MODES } from "@/lib/domain/enums";

const BLUE_TONES = new Set(["held", "moved"]);

describe("status display", () => {
  it("labels a released item by how the money went back", () => {
    expect(orderItemStatusDisplay("released", "authorize_then_capture")).toEqual({ label: "Voided", tone: "released" });
    expect(orderItemStatusDisplay("released", "capture_at_checkout")).toEqual({ label: "Refunded", tone: "moved" });
  });

  it("shows partial capture as money moved", () => {
    expect(orderItemStatusDisplay("adjusted", "authorize_then_capture")).toEqual({ label: "Partially captured", tone: "moved" });
  });

  it("never gives a listing state PayPal blue, because no money moves on a listing", () => {
    expect(LISTING_STATUSES.filter((status) => BLUE_TONES.has(LISTING_STATUS_DISPLAY[status].tone))).toEqual([]);
  });

  it("labels every order item state in both payment modes", () => {
    for (const mode of PAYMENT_MODES) {
      for (const status of ORDER_ITEM_STATUSES) expect(orderItemStatusDisplay(status, mode).label).not.toBe("");
    }
  });

  it("marks paid out as moved and every open dispute as an alert", () => {
    expect(PAYOUT_ITEM_STATUS_DISPLAY.succeeded).toEqual({ label: "Paid out", tone: "moved" });
    const open = DISPUTE_STATUSES.filter((status) => status !== "resolved");
    expect(open.map((status) => DISPUTE_STATUS_DISPLAY[status].tone)).toEqual(open.map(() => "alert"));
  });
});
