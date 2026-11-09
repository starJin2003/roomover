import { describe, expect, it } from "vitest";
import { hexToOklab, itemTones, oklabToHex, ROOM_PAINT_LIGHTNESS, ROOM_PAINT_MAX_CHROMA, roomPaint } from "@/components/room/model/tones";
import { listingColorsSchema } from "@/lib/domain/listing";
import { seedListings } from "@/scripts/seed/listings";

const chroma = (hex: string) => {
  const [, a, b] = hexToOklab(hex);
  return Math.hypot(a, b);
};

describe("room paint", () => {
  it("round trips sRGB through OKLab", () => {
    for (const hex of ["#F6F3EE", "#14151A", "#EC9902", "#3768AE"]) expect(oklabToHex(hexToOklab(hex))).toBe(hex);
  });

  it("keeps every seed swatch inside the room's lightness and chroma bounds", () => {
    for (const listing of seedListings("2026-11-08")) {
      for (const swatch of listingColorsSchema.parse(listing.colors)) {
        const paint = roomPaint(swatch.hex);
        const [lightness] = hexToOklab(paint);
        expect(lightness).toBeGreaterThanOrEqual(ROOM_PAINT_LIGHTNESS[0] - 0.01);
        expect(lightness).toBeLessThanOrEqual(ROOM_PAINT_LIGHTNESS[1] + 0.01);
        expect(chroma(paint)).toBeLessThanOrEqual(ROOM_PAINT_MAX_CHROMA + 0.01);
      }
    }
  });

  it("tones a loud color down and keeps its hue family", () => {
    const mustard = roomPaint("#EC9902");
    expect(chroma(mustard)).toBeLessThan(chroma("#EC9902"));
    const [, a, b] = hexToOklab(mustard);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    // Black lifts to graphite, never a hole.
    expect(hexToOklab(roomPaint("#000000"))[0]).toBeGreaterThan(0.3);
  });

  it("paints from photo swatches and falls back to color words", () => {
    expect(itemTones([{ hex: "#1C283A" }], "navy")).toEqual([roomPaint("#1C283A")]);
    expect(itemTones([], "black and brass")).toEqual(["graphite", "oak"]);
  });

  it("gives every seed listing at least one valid swatch", () => {
    for (const listing of seedListings("2026-11-08")) expect(listingColorsSchema.safeParse(listing.colors).success).toBe(true);
  });
});
