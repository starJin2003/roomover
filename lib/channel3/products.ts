import { z } from "zod";
import { channel3CandidateSchema, sizeFromRetail, toMillimeters, type Channel3Candidate } from "@/lib/domain/sell";

/**
 * The parts of a Channel3 product that Sell reads, parsed at the boundary.
 * Each product parses on its own, so one odd product drops out without
 * failing the search. A product has no price of its own, and each offer
 * carries a price, a merchant, and the merchant's stated size.
 */
const lengthSchema = z.object({ number: z.number().positive(), unit: z.enum(["mm", "cm", "m", "in", "ft"]) }).nullish();

const offerSchema = z.object({
  url: z.string().min(1),
  domain: z.string().min(1),
  price: z.object({ price: z.number().nonnegative(), currency: z.string().min(3) }),
  availability: z.string().nullish(),
  condition: z.string().nullish(),
  dimensions: z.object({ length: lengthSchema, width: lengthSchema, height: lengthSchema }).nullish(),
});

const productSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  brands: z.array(z.object({ name: z.string().min(1) })).nullish(),
  images: z.array(z.object({ url: z.string().min(1), cleaned_url: z.string().nullish(), is_main_image: z.boolean().nullish() })).nullish(),
  offers: z.array(offerSchema).nullish(),
});

export const searchResponseSchema = z.object({ products: z.array(z.unknown()) });

type Offer = z.infer<typeof offerSchema>;

/** Sell compares against at most this many products, and the seller agent looks at each one. */
export const MAX_CANDIDATES = 4;

const https = (url: string | null | undefined) => (url !== null && url !== undefined && url.startsWith("https://") ? url : null);

/** New, in stock, US dollar offers, cheapest first. A student comparing prices would buy the cheapest one. */
function newUsdOffers(offers: readonly Offer[]): Offer[] {
  return offers
    .filter((offer) => offer.price.currency === "USD" && offer.price.price > 0 && (offer.condition ?? "new") === "new" && (offer.availability ?? "InStock") === "InStock")
    .sort((a, b) => a.price.price - b.price.price);
}

function sizeOf(offers: readonly Offer[]): Channel3Candidate["sizeMm"] {
  for (const offer of offers) {
    const dims = offer.dimensions;
    if (dims === null || dims === undefined) continue;
    const size = sizeFromRetail({
      lengthMm: dims.length ? toMillimeters(dims.length) : null,
      widthMm: dims.width ? toMillimeters(dims.width) : null,
      heightMm: dims.height ? toMillimeters(dims.height) : null,
    });
    if (size !== null) return size;
  }
  return null;
}

export interface ParsedSearch {
  candidates: Channel3Candidate[];
  /** Products in the response, before any was dropped. */
  productCount: number;
}

/** Candidates in Channel3's order, each with a new US price, four by default for Sell. */
export function candidatesFrom(response: unknown, limit = MAX_CANDIDATES): ParsedSearch {
  const { products } = searchResponseSchema.parse(response);
  const candidates: Channel3Candidate[] = [];
  for (const raw of products) {
    const parsed = productSchema.safeParse(raw);
    if (!parsed.success) continue;
    const product = parsed.data;
    const offers = product.offers ?? [];
    const [cheapest] = newUsdOffers(offers);
    if (cheapest === undefined) continue;
    const images = product.images ?? [];
    const main = images.find((image) => image.is_main_image === true) ?? images[0];
    const candidate = channel3CandidateSchema.safeParse({
      productId: product.id,
      title: product.title,
      brand: product.brands?.[0]?.name ?? null,
      imageUrl: https(main?.cleaned_url) ?? https(main?.url),
      newPriceCents: Math.round(cheapest.price.price * 100),
      url: cheapest.url,
      domain: cheapest.domain,
      sizeMm: sizeOf(offers),
    });
    if (candidate.success) candidates.push(candidate.data);
    if (candidates.length === limit) break;
  }
  return { candidates, productCount: products.length };
}
