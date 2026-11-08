/** WCAG 2.2 relative luminance and contrast ratio for #RRGGBB colors. */

const HEX = /^#[0-9a-f]{6}$/i;

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function rgb(hex: string): [number, number, number] {
  if (!HEX.test(hex)) throw new RangeError(`Expected a #RRGGBB color, got ${hex}.`);
  const value = Number.parseInt(hex.slice(1), 16);
  return [value >> 16, (value >> 8) & 0xff, value & 0xff];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The sRGB mix CSS `color-mix(in srgb, base, other share)` produces, as #RRGGBB. */
export function mixHex(base: string, other: string, share: number): string {
  if (!(share >= 0 && share <= 1)) throw new RangeError(`Expected a share from 0 to 1, got ${share}.`);
  const a = rgb(base);
  const b = rgb(other);
  const mixed = a.map((value, index) => Math.round(value * (1 - share) + b[index] * share));
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * AA thresholds. Body text needs 4.5. Large text (24 px, or 18.66 px bold)
 * and the boundaries of controls and meaningful graphics need 3.
 */
export const AA_MINIMUM = { body: 4.5, large: 3, graphic: 3 } as const;

export type ContrastUse = keyof typeof AA_MINIMUM;

/** Rounds down, so a ratio shown as 4.50 never hides a 4.499 that fails. */
export function formatRatio(ratio: number): string {
  return (Math.floor(ratio * 100) / 100).toFixed(2);
}
