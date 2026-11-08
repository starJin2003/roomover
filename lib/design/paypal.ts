/**
 * PayPal's own rules for its marks and components, kept in one place so the
 * components and their tests agree.
 *
 * The monogram is the official full color file, scaled down without any other
 * change. PayPal's 2026 merchant toolkit sets the clear space at X on every
 * side, where X is the width of the two P stems, asks for at least 15 px in
 * digital use, and places the full color mark on white only.
 */
export const PAYPAL_MONOGRAM = {
  src: "/brand/paypal-monogram.png",
  /** Pixel size of the shipped file, four times the 20 by 24 display size. */
  fileWidthPx: 80,
  fileHeightPx: 96,
  /** Width over height of the official artwork, 901 by 1086. */
  aspect: 901 / 1086,
  /** The two P stems span 447 px of the 1086 px tall artwork. */
  clearSpaceRatio: 447 / 1086,
  minHeightPx: 15,
} as const;

export interface MonogramLayout {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly clearSpacePx: number;
}

/** Display size and clear space for a monogram of the given height. */
export function monogramLayout(heightPx: number): MonogramLayout {
  if (!(heightPx >= PAYPAL_MONOGRAM.minHeightPx)) {
    throw new RangeError(`The PayPal monogram needs at least ${PAYPAL_MONOGRAM.minHeightPx} px, got ${heightPx}.`);
  }
  return {
    widthPx: Math.round(heightPx * PAYPAL_MONOGRAM.aspect),
    heightPx,
    clearSpacePx: Math.ceil(heightPx * PAYPAL_MONOGRAM.clearSpaceRatio),
  };
}

/**
 * The JavaScript SDK v6 `<paypal-button>` measured in the sandbox on
 * 2026-11-08. It renders 45 px tall, fills its container at `width: 100%`,
 * and rounds its corners by 4 px.
 */
export const PAYPAL_SDK_BUTTON = { heightPx: 45, radiusPx: 4 } as const;
