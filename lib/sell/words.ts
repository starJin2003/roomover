import { formatUsdShort } from "@/lib/format";
import type { SellDraftView } from "./view";

/** The sentence under the title, saying where the new price and the size came from. */
export function sourceSentence(draft: Pick<SellDraftView, "details" | "match" | "similar" | "channel3">): string {
  const details = draft.details;
  if (details === null) return "";
  const price = `New about ${formatUsdShort(details.newPriceCents)}.`;
  if (draft.match !== null) return details.sizeMm === null ? `Filled in from your photo. ${price} Channel3 has no size for this product, so enter it yourself.` : `Filled in from your photo. ${price}`;
  if (draft.similar !== null) {
    const count = draft.similar.products.length;
    const items = count === 1 ? "1 similar item sells" : `${count} similar items sell`;
    return `Filled in from your photo. No exact match on Channel3. ${items} new for about ${formatUsdShort(draft.similar.referenceCents)}, so your price starts there.`;
  }
  if (draft.channel3.unavailable !== null) return `Filled in from your photo. ${draft.channel3.unavailable} The seller agent estimated the new price, about ${formatUsdShort(details.newPriceCents)}, so enter the size yourself.`;
  return `Filled in from your photo. Channel3 found no product that matches it, so the seller agent estimated the new price, about ${formatUsdShort(details.newPriceCents)}, and you enter the size.`;
}
