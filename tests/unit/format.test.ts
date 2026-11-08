import { describe, expect, it } from "vitest";
import { CONDITION_GRADES } from "@/lib/domain/listing";
import { conditionScore, formatCentimeters, formatInches, formatUsd, formatUsdChange } from "@/lib/format";
import { seedListings } from "@/scripts/seed/listings";

describe("formatUsd", () => {
  it("formats integer cents as US dollars", () => {
    expect(formatUsd(1_600)).toBe("$16.00");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(123_456)).toBe("$1,234.56");
    expect(formatUsd(-13_600)).toBe("−$136.00");
  });

  it("refuses amounts that are not integer cents", () => {
    expect(() => formatUsd(16.5)).toThrow(RangeError);
    expect(() => formatUsdChange(Number.NaN)).toThrow(RangeError);
  });

  it("signs balance changes and leaves zero unsigned", () => {
    expect(formatUsdChange(1_600)).toBe("+$16.00");
    expect(formatUsdChange(-13_600)).toBe("−$136.00");
    expect(formatUsdChange(0)).toBe("$0.00");
  });
});

describe("dimensions", () => {
  it("shows half inches and whole centimeters", () => {
    expect(formatInches([420, 180, 480])).toBe("16.5 × 7 × 19 in");
    expect(formatCentimeters([420, 180, 480])).toBe("42 × 18 × 48 cm");
  });

  it("keeps one decimal under one unit so a flat rug never reads as zero", () => {
    expect(formatInches([1_220, 2_130, 5])).toBe("48 × 84 × 0.2 in");
    expect(formatCentimeters([1_220, 2_130, 5])).toBe("122 × 213 × 0.5 cm");
  });

  it("shows no zero dimension for any seed listing", () => {
    for (const listing of seedListings("2026-11-08")) {
      const size = [listing.widthMm, listing.depthMm, listing.heightMm] as const;
      expect(`${formatInches(size)} ${formatCentimeters(size)}`).not.toMatch(/(^|\s)0(\s|$)/);
    }
  });
});

describe("condition score", () => {
  it("runs from 4 for like new down to 1 for worn", () => {
    expect(CONDITION_GRADES.map(conditionScore)).toEqual([4, 3, 2, 1]);
  });
});
