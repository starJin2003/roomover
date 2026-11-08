import { describe, expect, it } from "vitest";
import { PAYOUT_ARRIVALS, SELLER_PAYOUTS } from "@/app/style-guide/demo-data";
import { sellersPaidProgress } from "@/lib/design/sellers-paid";

const LINES = [
  { payoutItemId: "JUN", amountCents: 5_200 },
  { payoutItemId: "MARCUS", amountCents: 3_000 },
  { payoutItemId: "LEA", amountCents: 3_000 },
  { payoutItemId: "AVA", amountCents: 1_600 },
  { payoutItemId: "SOFIA", amountCents: 800 },
];

describe("sellers paid progress", () => {
  it("starts with every row pending and nothing sent", () => {
    const progress = sellersPaidProgress(LINES, []);
    expect(progress.rows.map((row) => row.paidOrder)).toEqual([null, null, null, null, null]);
    expect(progress).toMatchObject({ paidCount: 0, paidCents: 0, totalCents: 13_600, allPaid: false });
  });

  it("fills rows in the order payout events arrive and keeps the display order", () => {
    const progress = sellersPaidProgress(LINES, ["LEA", "JUN", "SOFIA"]);
    expect(progress.rows.map((row) => row.payoutItemId)).toEqual(["JUN", "MARCUS", "LEA", "AVA", "SOFIA"]);
    expect(progress.rows.map((row) => row.paidOrder)).toEqual([2, null, 1, null, 3]);
    expect(progress.paidCents).toBe(9_000);
  });

  it("ticks the total up by each seller's amount, one event at a time", () => {
    const arrivals = ["LEA", "JUN", "SOFIA", "AVA", "MARCUS"];
    const totals = arrivals.map((_, index) => sellersPaidProgress(LINES, arrivals.slice(0, index + 1)).paidCents);
    expect(totals).toEqual([3_000, 8_200, 9_000, 10_600, 13_600]);
    expect(sellersPaidProgress(LINES, arrivals).allPaid).toBe(true);
  });

  it("ignores a repeated webhook and an unknown payout item", () => {
    const progress = sellersPaidProgress(LINES, ["AVA", "AVA", "NOT-OURS", "SOFIA"]);
    expect(progress.rows.map((row) => row.paidOrder)).toEqual([null, null, null, 1, 2]);
    expect(progress).toMatchObject({ paidCount: 2, paidCents: 2_400, allPaid: false });
  });

  it("never reports an empty list as all paid", () => {
    expect(sellersPaidProgress([], []).allPaid).toBe(false);
  });

  it("pays every seller in the style guide replay exactly once", () => {
    const progress = sellersPaidProgress(SELLER_PAYOUTS, PAYOUT_ARRIVALS);
    expect(progress.allPaid).toBe(true);
    expect(new Set(PAYOUT_ARRIVALS).size).toBe(SELLER_PAYOUTS.length);
    expect(progress.paidCents).toBe(progress.totalCents);
  });
});
