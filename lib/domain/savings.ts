/**
 * What the used items in a plan save against buying them new. Each used
 * item is compared with comparable new products Channel3 found for it, and
 * a new item the agent added is its own line, since the student buys it
 * from the retailer and it never joins the PayPal order.
 */

export interface SavingsLine {
  listingId: string;
  /** What the student pays for the used item, the agreed price when there is one. */
  paidCents: number;
  /** The new price Channel3's comparable products point to, or null before any reference exists. */
  newCents: number | null;
}

export interface Savings {
  /** What the used items with a reference cost the student. */
  paidCents: number;
  /** What the same items cost new. */
  newCents: number;
  savedCents: number;
  /** Used items with a reference, out of all used items. */
  compared: number;
  total: number;
}

export function usedSavings(lines: readonly SavingsLine[]): Savings {
  const compared = lines.filter((line): line is SavingsLine & { newCents: number } => line.newCents !== null);
  const paidCents = compared.reduce((sum, line) => sum + line.paidCents, 0);
  const newCents = compared.reduce((sum, line) => sum + line.newCents, 0);
  const savedCents = compared.reduce((sum, line) => sum + Math.max(0, line.newCents - line.paidCents), 0);
  return { paidCents, newCents, savedCents, compared: compared.length, total: lines.length };
}

/**
 * One new price from several comparable products: the cheapest. Channel3
 * ranks designer stores high for many queries, so a median would overstate
 * what a student pays new, and the cheapest keeps every savings claim a
 * floor. Sell takes the cheapest new offer the same way.
 */
export function referencePriceCents(pricesCents: readonly number[]): number | null {
  const prices = pricesCents.filter((price) => Number.isSafeInteger(price) && price > 0);
  return prices.length === 0 ? null : Math.min(...prices);
}

/** "New from target.com", the label every new item carries in the room, the list, and the panel. */
export function newItemLabel(retailer: string): string {
  return `New from ${retailer}`;
}

/** A retailer's domain as the panel names it: lower case, without www. */
export function retailerName(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, "");
}
