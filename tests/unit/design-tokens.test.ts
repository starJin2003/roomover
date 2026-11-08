import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AA_MINIMUM, contrastRatio, formatRatio, relativeLuminance } from "@/lib/design/contrast";
import { COLOR, CONTRAST_PAIRS, MOTION, PALETTE, RADIUS_SCALE, TYPE_SCALE } from "@/lib/design/tokens";

const globals = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
const themeBlock = /@theme \{([\s\S]*?)\n\}/.exec(globals)?.[1] ?? "";

function themeValue(name: string): string | undefined {
  return new RegExp(`^\\s*--${name}:\\s*([^;]+);`, "m").exec(themeBlock)?.[1]?.trim();
}

describe("contrast math", () => {
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

  it("rejects colors that are not #RRGGBB", () => {
    expect(() => relativeLuminance("#FFF")).toThrow(RangeError);
    expect(() => relativeLuminance("blue")).toThrow(RangeError);
  });
});

describe("palette contrast", () => {
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

  it("records the finding that made Flint necessary", () => {
    expect(contrastRatio(COLOR.stone, COLOR.paper)).toBeLessThan(AA_MINIMUM.body);
    expect(contrastRatio(COLOR.flint, COLOR.paper)).toBeGreaterThanOrEqual(AA_MINIMUM.body);
  });

  it("keeps the six palette colors from onboarding unchanged", () => {
    expect(COLOR).toMatchObject({
      paper: "#F6F3EE",
      ink: "#14151A",
      stone: "#8C877D",
      navy: "#002991",
      blue: "#008CFF",
      sky: "#60CDFF",
    });
  });
});

describe("globals.css theme", () => {
  it("starts every token namespace from initial", () => {
    for (const namespace of ["color", "font", "text", "radius", "shadow", "ease"]) {
      expect(themeBlock).toContain(`--${namespace}-*: initial;`);
    }
  });

  it("declares exactly the palette colors", () => {
    const declared = [...themeBlock.matchAll(/^\s*--color-([a-z]+):\s*(#[0-9A-Fa-f]{6});/gm)].map(([, token, hex]) => [token, hex]);
    expect(Object.fromEntries(declared)).toEqual(COLOR);
    expect(declared).toHaveLength(PALETTE.length);
  });

  it("declares the type, radius, and motion scales from tokens.ts", () => {
    for (const step of TYPE_SCALE) {
      expect(themeValue(`text-${step.token}`)).toBe(`${step.px}px`);
      expect(themeValue(`text-${step.token}--line-height`)).toBe(`${step.lineHeight}px`);
    }
    for (const radius of RADIUS_SCALE) expect(themeValue(`radius-${radius.token}`)).toBe(`${radius.px}px`);
    for (const motion of MOTION) expect(themeValue(`duration-${motion.token}`)).toBe(`${motion.ms}ms`);
  });
});
