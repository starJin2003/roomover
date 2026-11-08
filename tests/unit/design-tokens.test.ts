import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AA_MINIMUM, contrastRatio, formatRatio, mixHex, relativeLuminance } from "@/lib/design/contrast";
import { monogramLayout, PAYPAL_MONOGRAM, PAYPAL_SDK_BUTTON } from "@/lib/design/paypal";
import {
  BRAND_GROUNDS,
  COLOR,
  CONTRAST_PAIRS,
  FONT_WEIGHTS,
  MOTION,
  PALETTE,
  RADIUS_SCALE,
  SURFACES,
  TYPE_SCALE,
} from "@/lib/design/tokens";

const globals = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
const themeBlock = /@theme \{([\s\S]*?)\n\}/.exec(globals)?.[1] ?? "";

function themeValue(name: string): string | undefined {
  return new RegExp(`^\\s*--${name}:\\s*([^;]+);`, "m").exec(themeBlock)?.[1]?.trim();
}

describe("color math", () => {
  it("matches the WCAG reference points", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#8C877D", "#8C877D")).toBe(1);
    expect(relativeLuminance("#FFFFFF")).toBe(1);
    expect(contrastRatio("#14151A", "#F6F3EE")).toBe(contrastRatio("#F6F3EE", "#14151A"));
  });

  it("rounds ratios down so a near miss never shows as a pass", () => {
    expect(formatRatio(4.499)).toBe("4.49");
    expect(formatRatio(16.479)).toBe("16.47");
  });

  it("rejects colors that are not #RRGGBB and shares outside 0 to 1", () => {
    expect(() => relativeLuminance("#FFF")).toThrow(RangeError);
    expect(() => relativeLuminance("blue")).toThrow(RangeError);
    expect(() => mixHex("#000000", "#FFFFFF", 1.5)).toThrow(RangeError);
  });

  it("mixes in sRGB the way CSS color-mix does", () => {
    expect(mixHex("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mixHex("#F6F3EE", "#8C877D", 0)).toBe("#F6F3EE");
    expect(mixHex("#F6F3EE", "#8C877D", 1)).toBe("#8C877D");
  });
});

describe("palette and surfaces", () => {
  it("keeps the six palette colors from onboarding unchanged", () => {
    expect(COLOR).toMatchObject({
      paper: "#F6F3EE",
      ink: "#14151A",
      stone: "#8C877D",
      navy: "#002991",
      blue: "#008CFF",
      sky: "#60CDFF",
    });
    expect(PALETTE).toHaveLength(8);
  });

  it.each(SURFACES.map((surface) => [surface.name, surface] as const))("derives %s from its palette recipe", (_, surface) => {
    expect(surface.hex).toBe(mixHex(COLOR[surface.mix.base], COLOR[surface.mix.other], surface.mix.share));
  });

  it("gives the PayPal monogram the white ground PayPal requires", () => {
    expect(BRAND_GROUNDS).toEqual([expect.objectContaining({ token: "paypal-ground", hex: "#FFFFFF" })]);
  });
});

describe("contrast", () => {
  it.each(CONTRAST_PAIRS.map((pair) => [`${pair.foreground} on ${pair.background} for ${pair.use}`, pair] as const))(
    "%s meets AA",
    (_, pair) => {
      expect(contrastRatio(COLOR[pair.foreground], COLOR[pair.background])).toBeGreaterThanOrEqual(AA_MINIMUM[pair.use]);
    },
  );

  it("keeps PayPal blue and Sky out of text, and Stone out of body text", () => {
    const textPairs = CONTRAST_PAIRS.filter((pair) => pair.use !== "graphic");
    expect(textPairs.filter((pair) => pair.foreground === "blue" || pair.foreground === "sky")).toEqual([]);
    expect(CONTRAST_PAIRS.filter((pair) => pair.foreground === "stone" && pair.use === "body")).toEqual([]);
  });

  it("puts Paper text on the navy card at 10.99 to 1", () => {
    expect(formatRatio(contrastRatio(COLOR.paper, COLOR.navy))).toBe("10.99");
  });

  it("records why Stone stays off the table and off text", () => {
    expect(contrastRatio(COLOR.stone, COLOR.table)).toBeLessThan(AA_MINIMUM.graphic);
    expect(contrastRatio(COLOR.stone, COLOR.paper)).toBeLessThan(AA_MINIMUM.body);
    expect(contrastRatio(COLOR.flint, COLOR.table)).toBeGreaterThanOrEqual(AA_MINIMUM.body);
  });
});

describe("globals.css theme", () => {
  it("starts every token namespace from initial", () => {
    for (const namespace of ["color", "font", "font-weight", "text", "radius", "shadow", "ease"]) {
      expect(themeBlock).toContain(`--${namespace}-*: initial;`);
    }
  });

  it("declares exactly the palette, surface, and brand ground colors, plus the hairline", () => {
    const declared = [...themeBlock.matchAll(/^\s*--color-([a-z-]+):\s*(#[0-9A-Fa-f]{6});/gm)].map(([, token, hex]) => [token, hex]);
    expect(Object.fromEntries(declared)).toEqual(COLOR);
    expect(declared).toHaveLength(PALETTE.length + SURFACES.length + BRAND_GROUNDS.length);
    expect(themeValue("color-hair")).toBe(`color-mix(in srgb, ${COLOR.ink} 9%, transparent)`);
  });

  it("declares only weights 400, 500, and 600", () => {
    const weights = [...themeBlock.matchAll(/^\s*--font-weight-([a-z]+):\s*(\d+);/gm)].map(([, token, weight]) => [token, Number(weight)]);
    expect(Object.fromEntries(weights)).toEqual(Object.fromEntries(FONT_WEIGHTS.map((weight) => [weight.token, weight.weight])));
    expect(Math.max(...FONT_WEIGHTS.map((weight) => weight.weight))).toBe(600);
  });

  it("declares the seven sizes, radius, and motion scales from tokens.ts", () => {
    expect(TYPE_SCALE).toHaveLength(7);
    for (const step of TYPE_SCALE) {
      expect(themeValue(`text-${step.token}`)).toBe(`${step.px}px`);
      expect(themeValue(`text-${step.token}--line-height`)).toBe(`${step.lineHeight}px`);
    }
    for (const radius of RADIUS_SCALE) expect(themeValue(`radius-${radius.token}`)).toBe(`${radius.px}px`);
    for (const motion of MOTION) expect(themeValue(`duration-${motion.token}`)).toBe(`${motion.ms}ms`);
  });

  it("draws every key skirt in a palette or surface color", () => {
    expect(themeValue("shadow-key-ink")).toContain(`inset 0 -4px 0 ${COLOR.ink}`);
    expect(themeValue("shadow-key-paper")).toContain(`inset 0 -4px 0 ${COLOR.skirt}`);
    expect(themeValue("shadow-key-brick")).toContain(`inset 0 -4px 0 ${COLOR["brick-skirt"]}`);
  });
});

describe("PayPal brand rules", () => {
  it("keeps the monogram's proportions and clear space of two stem widths", () => {
    expect(monogramLayout(24)).toEqual({ widthPx: 20, heightPx: 24, clearSpacePx: 10 });
    expect(PAYPAL_MONOGRAM.fileWidthPx / PAYPAL_MONOGRAM.fileHeightPx).toBeCloseTo(PAYPAL_MONOGRAM.aspect, 2);
  });

  it("refuses a monogram below PayPal's 15 px digital minimum", () => {
    expect(monogramLayout(15).heightPx).toBe(15);
    expect(() => monogramLayout(14)).toThrow(RangeError);
  });

  it("sizes the SDK slot like the measured v6 button", () => {
    expect(PAYPAL_SDK_BUTTON).toEqual({ heightPx: 45, radiusPx: 4 });
  });
});
