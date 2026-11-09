/**
 * Bounds on a used price. The seller agent proposes a price and a floor from
 * the condition and the new price, and code keeps both inside these bounds,
 * so the model never sets a price on its own. The seller's stepper moves
 * inside the same bounds, and the server clamps again when the item is listed.
 */

/** A used item never asks more than this share of the new price. */
export const MAX_SHARE_OF_NEW = 0.7;
/** The floor never drops below this share of the asking price. */
export const MIN_FLOOR_SHARE = 0.5;
export const MIN_PRICE_CENTS = 200;
/** The largest new price Roomover prices from, so one wrong match cannot ask four figures for a lamp. */
export const MAX_NEW_PRICE_CENTS = 150_000;

const DOLLAR = 100;
const wholeDollars = (cents: number) => Math.round(cents / DOLLAR) * DOLLAR;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export interface PriceBounds {
  minPriceCents: number;
  maxPriceCents: number;
}

/** Whole dollars from $2 up to 70 percent of the new price, rounded down so the cap holds. */
export function priceBounds(newPriceCents: number): PriceBounds {
  const cappedNew = clamp(newPriceCents, MIN_PRICE_CENTS, MAX_NEW_PRICE_CENTS);
  const maxPriceCents = Math.max(MIN_PRICE_CENTS, Math.floor((cappedNew * MAX_SHARE_OF_NEW) / DOLLAR) * DOLLAR);
  return { minPriceCents: MIN_PRICE_CENTS, maxPriceCents };
}

/** The lowest floor allowed for a price, half of it rounded up to the dollar. */
export function minFloorCents(priceCents: number): number {
  return Math.ceil((priceCents * MIN_FLOOR_SHARE) / DOLLAR) * DOLLAR;
}

export interface UsedPrice {
  priceCents: number;
  floorPriceCents: number;
}

/** Rounds a proposal to whole dollars and moves each value inside its bounds, the price first. */
export function clampPrices(proposal: UsedPrice, newPriceCents: number): UsedPrice {
  const bounds = priceBounds(newPriceCents);
  const priceCents = clamp(wholeDollars(proposal.priceCents), bounds.minPriceCents, bounds.maxPriceCents);
  const floorPriceCents = clamp(wholeDollars(proposal.floorPriceCents), minFloorCents(priceCents), priceCents);
  return { priceCents, floorPriceCents };
}
