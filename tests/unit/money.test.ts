import { describe, expect, it } from "vitest";
import {
  allocateByWeight,
  centsToDecimal,
  decimalToCents,
  splitEvenly,
  sumCents,
} from "@/lib/domain/money";
import { moneyToCents, payoutMoney, restMoney, sdkMoney } from "@/lib/paypal/wire-money";

describe("centsToDecimal", () => {
  it.each([
    [0, "0.00"],
    [1, "0.01"],
    [10, "0.10"],
    [99, "0.99"],
    [100, "1.00"],
    [12_345, "123.45"],
    [150_000, "1500.00"],
  ])("formats %i cents as %s", (cents, expected) => {
    expect(centsToDecimal(cents)).toBe(expected);
  });

  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("rejects %d", (cents) => {
    expect(() => centsToDecimal(cents)).toThrow(RangeError);
  });
});

describe("decimalToCents", () => {
  it.each([
    ["0.00", 0],
    ["0.01", 1],
    ["0.1", 10],
    ["7", 700],
    ["12.30", 1230],
    ["1500.00", 150_000],
  ])("reads %s as %i cents", (value, expected) => {
    expect(decimalToCents(value)).toBe(expected);
  });

  it.each(["", "1.234", "-1.00", "+1.00", "1e3", "01.00", "1.", ".50", " 1.00", "1,000.00"])(
    "rejects %j",
    (value) => {
      expect(() => decimalToCents(value)).toThrow(RangeError);
    },
  );

  it("round trips every cent value without drift", () => {
    for (let cents = 0; cents <= 10_000; cents += 1) {
      expect(decimalToCents(centsToDecimal(cents))).toBe(cents);
    }
  });
});

describe("sumCents", () => {
  it("adds integer cents where float addition would drift", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumCents([10, 20])).toBe(30);
  });

  it("rejects a fractional value", () => {
    expect(() => sumCents([10, 0.5])).toThrow(RangeError);
  });
});

describe("splitEvenly", () => {
  it("gives the leftover cent to the earliest share", () => {
    expect(splitEvenly(100, 3)).toEqual([34, 33, 33]);
  });

  it("splits one cent across three items", () => {
    expect(splitEvenly(1, 3)).toEqual([1, 0, 0]);
  });

  it("splits two cents across three items", () => {
    expect(splitEvenly(2, 3)).toEqual([1, 1, 0]);
  });

  it("splits zero", () => {
    expect(splitEvenly(0, 2)).toEqual([0, 0]);
  });

  it("always sums to the total", () => {
    for (let total = 0; total <= 1_000; total += 7) {
      for (let parts = 1; parts <= 9; parts += 1) {
        expect(sumCents(splitEvenly(total, parts))).toBe(total);
      }
    }
  });

  it.each([0, -1, 1.5])("rejects %d parts", (parts) => {
    expect(() => splitEvenly(100, parts)).toThrow(RangeError);
  });
});

describe("allocateByWeight", () => {
  it("splits in proportion to list prices", () => {
    expect(allocateByWeight(10_000, [2_500, 7_500])).toEqual([2_500, 7_500]);
  });

  it("gives a 0.01 remainder to the largest fractional share", () => {
    // 9.99 split 25 / 75 is 2.4975 and 7.4925, so the leftover cent goes to the first share.
    expect(allocateByWeight(999, [2_500, 7_500])).toEqual([250, 749]);
  });

  it("breaks a remainder tie by position", () => {
    expect(allocateByWeight(1_000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(allocateByWeight(1, [50, 50])).toEqual([1, 0]);
  });

  it("gives nothing to a zero weight", () => {
    expect(allocateByWeight(500, [0, 3, 2])).toEqual([0, 300, 200]);
  });

  it("always sums to the total", () => {
    const weights = [1_999, 3_550, 7_225, 1];
    for (let total = 0; total <= 5_000; total += 13) {
      expect(sumCents(allocateByWeight(total, weights))).toBe(total);
    }
  });

  it("handles totals and weights whose product exceeds the safe integer range", () => {
    const shares = allocateByWeight(9_000_000_000_000, [9_000_000_000_000, 1]);
    expect(sumCents(shares)).toBe(9_000_000_000_000);
  });

  it("rejects empty or all zero weights", () => {
    expect(() => allocateByWeight(100, [])).toThrow(RangeError);
    expect(() => allocateByWeight(100, [0, 0])).toThrow(RangeError);
  });
});

describe("PayPal wire money", () => {
  it("writes each PayPal spelling of the same amount", () => {
    expect(sdkMoney(2_550)).toEqual({ currencyCode: "USD", value: "25.50" });
    expect(restMoney(2_550)).toEqual({ currency_code: "USD", value: "25.50" });
    expect(payoutMoney(2_550)).toEqual({ currency: "USD", value: "25.50" });
  });

  it("reads USD back into cents and rejects other currencies", () => {
    expect(moneyToCents({ currency: "USD", value: "25.50" })).toBe(2_550);
    expect(() => moneyToCents({ currency: "EUR", value: "25.50" })).toThrow(RangeError);
  });
});
