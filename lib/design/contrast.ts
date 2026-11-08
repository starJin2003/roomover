/** WCAG 2.2 relative luminance and contrast ratio for #RRGGBB colors. */

const HEX = /^#[0-9a-f]{6}$/i;

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  if (!HEX.test(hex)) throw new RangeError(`Expected a #RRGGBB color, got ${hex}.`);
  const value = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel(value >> 16) + 0.7152 * channel((value >> 8) & 0xff) + 0.0722 * channel(value & 0xff);
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
