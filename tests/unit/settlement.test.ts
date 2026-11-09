import { describe, expect, it } from "vitest";
import { needsReauthorization, payoutLines, settlementSteps, settlementTotals, type SettlementLine, type SettlementOrder } from "@/lib/domain/settlement";

const NOW = new Date("2026-11-09T18:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const authorize: SettlementOrder = { paymentMode: "authorize_then_capture", approvedAt: new Date(NOW.getTime() - 60 * 60 * 1000), reauthorizedAt: null, voided: false };
const capture: SettlementOrder = { ...authorize, paymentMode: "capture_at_checkout" };

const line = (orderItemId: string, sellerId: string, amountCents: number, payCents: number, landed: Partial<Pick<SettlementLine, "captureId" | "refundId">> = {}): SettlementLine => ({
  orderItemId,
  sellerId,
  amountCents,
  payCents,
  captureId: landed.captureId ?? null,
  refundId: landed.refundId ?? null,
});

const cart = [line("desk", "jun", 5_500, 5_500), line("chair", "marcus", 3_500, 3_000), line("lamp", "ava", 1_600, 1_600), line("clamp", "sofia", 800, 800), line("bag", "lea", 3_000, 3_000)];

describe("settlementSteps in authorize mode", () => {
  it("captures each kept item and marks only the last capture final", () => {
    expect(settlementSteps(authorize, cart, NOW)).toEqual([
      { kind: "capture", orderItemId: "desk", amountCents: 5_500, finalCapture: false },
      { kind: "capture", orderItemId: "chair", amountCents: 3_000, finalCapture: false },
      { kind: "capture", orderItemId: "lamp", amountCents: 1_600, finalCapture: false },
      { kind: "capture", orderItemId: "clamp", amountCents: 800, finalCapture: false },
      { kind: "capture", orderItemId: "bag", amountCents: 3_000, finalCapture: true },
    ]);
  });

  it("makes the last kept item final when the items after it were released, so no void follows", () => {
    const steps = settlementSteps(authorize, [line("desk", "jun", 5_500, 5_500), line("chair", "marcus", 3_500, 0)], NOW);
    expect(steps).toEqual([{ kind: "capture", orderItemId: "desk", amountCents: 5_500, finalCapture: true }]);
  });

  it("voids the hold when nothing is left to capture", () => {
    expect(settlementSteps(authorize, [line("desk", "jun", 5_500, 0), line("chair", "marcus", 3_500, 0)], NOW)).toEqual([{ kind: "void" }]);
    expect(settlementSteps({ ...authorize, voided: true }, [line("desk", "jun", 5_500, 0)], NOW)).toEqual([]);
  });

  it("skips captures that already landed on a retry and keeps the final flag on the same item", () => {
    const retried = cart.map((entry, index) => (index < 2 ? { ...entry, captureId: `CAP${index}` } : entry));
    expect(settlementSteps(authorize, retried, NOW)).toEqual([
      { kind: "capture", orderItemId: "lamp", amountCents: 1_600, finalCapture: false },
      { kind: "capture", orderItemId: "clamp", amountCents: 800, finalCapture: false },
      { kind: "capture", orderItemId: "bag", amountCents: 3_000, finalCapture: true },
    ]);
    expect(settlementSteps(authorize, cart.map((entry) => ({ ...entry, captureId: "CAP" })), NOW)).toEqual([]);
  });

  it("reauthorizes once, before the first capture, when handoff comes after the honor period", () => {
    const late = { ...authorize, approvedAt: new Date(NOW.getTime() - 4 * DAY) };
    const steps = settlementSteps(late, cart, NOW);
    expect(steps[0]).toEqual({ kind: "reauthorize", amountCents: 13_900 });
    expect(steps.slice(1).every((step) => step.kind === "capture")).toBe(true);
    expect(settlementSteps({ ...late, reauthorizedAt: new Date(NOW.getTime() - DAY) }, cart, NOW)[0].kind).toBe("capture");
  });

  it("does not reauthorize in the middle of captures that already started", () => {
    const late = { ...authorize, approvedAt: new Date(NOW.getTime() - 4 * DAY) };
    const started = cart.map((entry, index) => (index === 0 ? { ...entry, captureId: "CAP0" } : entry));
    expect(settlementSteps(late, started, NOW)[0].kind).toBe("capture");
  });

  it("refuses an empty settlement and a pay amount outside the price", () => {
    expect(() => settlementSteps(authorize, [], NOW)).toThrow(RangeError);
    expect(() => settlementSteps(authorize, [line("desk", "jun", 5_500, 5_600)], NOW)).toThrow(RangeError);
    expect(() => settlementSteps(authorize, [line("desk", "jun", 5_500, -1)], NOW)).toThrow(RangeError);
  });
});

describe("needsReauthorization", () => {
  it("holds inside the honor period, renews from day 3 to day 29, and never twice", () => {
    const at = (days: number) => ({ approvedAt: new Date(NOW.getTime() - days * DAY), reauthorizedAt: null });
    expect(needsReauthorization(at(2.9), NOW)).toBe(false);
    expect(needsReauthorization(at(3.1), NOW)).toBe(true);
    expect(needsReauthorization(at(28.9), NOW)).toBe(true);
    expect(needsReauthorization(at(29.1), NOW)).toBe(false);
    expect(needsReauthorization({ ...at(10), reauthorizedAt: new Date(NOW.getTime() - 5 * DAY) }, NOW)).toBe(false);
  });
});

describe("settlementSteps in capture mode", () => {
  it("refunds what each item gives back from the checkout capture and never captures", () => {
    const lines = [line("desk", "jun", 5_500, 5_500), line("chair", "marcus", 3_500, 3_000), line("lamp", "ava", 1_600, 0)];
    expect(settlementSteps(capture, lines, NOW)).toEqual([
      { kind: "refund", orderItemId: "chair", amountCents: 500 },
      { kind: "refund", orderItemId: "lamp", amountCents: 1_600 },
    ]);
  });

  it("skips refunds that already landed", () => {
    const lines = [line("chair", "marcus", 3_500, 3_000, { refundId: "REF1" }), line("lamp", "ava", 1_600, 0)];
    expect(settlementSteps(capture, lines, NOW)).toEqual([{ kind: "refund", orderItemId: "lamp", amountCents: 1_600 }]);
  });

  it("has nothing to do when every item was kept in full", () => {
    expect(settlementSteps(capture, [line("desk", "jun", 5_500, 5_500)], NOW)).toEqual([]);
  });
});

describe("payoutLines", () => {
  it("pays each seller once, summing their kept items, in the order they first appear", () => {
    const lines = [line("bag", "lea", 3_000, 3_000), line("desk", "jun", 5_500, 5_500), line("throw", "lea", 1_800, 1_800), line("chair", "marcus", 3_500, 0)];
    expect(payoutLines(lines)).toEqual([
      { sellerId: "lea", amountCents: 4_800, orderItemIds: ["bag", "throw"] },
      { sellerId: "jun", amountCents: 5_500, orderItemIds: ["desk"] },
    ]);
  });

  it("pays the five demo sellers $139 for the cart with the torn chair", () => {
    const lines = payoutLines(cart);
    expect(lines.map((entry) => [entry.sellerId, entry.amountCents])).toEqual([
      ["jun", 5_500],
      ["marcus", 3_000],
      ["ava", 1_600],
      ["sofia", 800],
      ["lea", 3_000],
    ]);
    expect(settlementTotals(cart)).toEqual({ heldCents: 14_400, paidCents: 13_900, releasedCents: 500 });
  });
});
