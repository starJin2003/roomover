/**
 * CC0 photos of items that are not in the seed catalog, committed under
 * public/sell-samples with their credits, so judges can try Sell without a
 * camera. Each one is a product retailers sell new, so Channel3 can match it.
 */
export interface SellSample {
  slug: string;
  src: string;
  /** What the sample shows, read aloud and shown under the thumbnail. */
  label: string;
  widthPx: number;
  heightPx: number;
}

export const SELL_SAMPLES: readonly SellSample[] = [
  { slug: "black-rolling-cart", src: "/sell-samples/black-rolling-cart.jpg", label: "Black rolling cart", widthPx: 953, heightPx: 1200 },
  { slug: "white-tufted-side-chair", src: "/sell-samples/white-tufted-side-chair.jpg", label: "White side chair", widthPx: 920, heightPx: 1068 },
  { slug: "blue-laundry-basket", src: "/sell-samples/blue-laundry-basket.jpg", label: "Blue laundry basket", widthPx: 1200, heightPx: 764 },
];

export function sellSample(slug: string): SellSample | undefined {
  return SELL_SAMPLES.find((sample) => sample.slug === slug);
}

export function sellSampleBySrc(src: string): SellSample | undefined {
  return SELL_SAMPLES.find((sample) => sample.src === src);
}
