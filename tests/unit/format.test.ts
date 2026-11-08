import { describe, expect, it } from "vitest";
import { formatCentimeters, formatDayRange, formatInches, formatUsd, formatUsdShort } from "@/lib/format";
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
    expect(() => formatUsdShort(Number.NaN)).toThrow(RangeError);
  });
});

describe("formatUsdShort", () => {
  it("drops the cents from whole dollars and keeps them otherwise", () => {
    expect(formatUsdShort(5_200)).toBe("$52");
    expect(formatUsdShort(14_100)).toBe("$141");
    expect(formatUsdShort(3_525)).toBe("$35.25");
    expect(formatUsdShort(123_400)).toBe("$1,234");
    expect(formatUsdShort(-500)).toBe("−$5");
  });
});

describe("formatDayRange", () => {
  it("names the month once inside one month and twice across months, in campus time", () => {
    expect(formatDayRange(new Date("2026-11-17T15:00:00Z"), new Date("2026-11-26T02:00:00Z"))).toBe("Nov 17 to 25");
    expect(formatDayRange(new Date("2026-11-30T15:00:00Z"), new Date("2026-12-02T15:00:00Z"))).toBe("Nov 30 to Dec 2");
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
