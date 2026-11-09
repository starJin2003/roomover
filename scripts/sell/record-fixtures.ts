import { writeFile } from "node:fs/promises";
import type Anthropic from "@anthropic-ai/sdk";
import { describeListing, liveSellerTransport } from "@/lib/agents/seller/describe";
import { photoData, readPublicPhoto, sha256 } from "@/lib/agents/verifier/facts";
import { candidatesFrom } from "@/lib/channel3/products";
import { liveChannel3Transport } from "@/lib/channel3/transport";
import { readConfig } from "@/lib/config";
import { draftDetailsFrom } from "@/lib/domain/sell";
import { formatUsdShort } from "@/lib/format";
import { fetchProductPhoto } from "@/lib/sell/photos";
import { SELL_SAMPLES } from "@/lib/sell/samples";

/**
 * Runs Channel3's image search and the live seller agent over every Sell
 * sample photo, prints what each one filled in, and saves both answers as
 * the fixtures the e2e tests replay. Each sample costs one Channel3 credit
 * and one or two Claude calls.
 *
 *   pnpm sell:record-fixtures
 */

const CHANNEL3_OUT = "tests/fixtures/channel3.json";
const SELLER_OUT = "tests/fixtures/seller-agent.json";

/** Keeps the product fields Sell reads, so the fixture stays small and holds no tracking links Roomover never uses. */
function trimmed(response: unknown): { products: unknown[] } {
  const products = (response as { products?: Record<string, unknown>[] }).products ?? [];
  return {
    products: products.map((product) => ({
      id: product.id,
      title: product.title,
      brands: product.brands,
      images: (product.images as { url: string; cleaned_url?: string; is_main_image?: boolean }[] | undefined)?.filter((image) => image.is_main_image === true).slice(0, 1),
      offers: (product.offers as Record<string, unknown>[] | undefined)?.map((offer) => ({ url: offer.url, domain: offer.domain, price: offer.price, availability: offer.availability, condition: offer.condition, dimensions: offer.dimensions })),
    })),
  };
}

async function main() {
  const { ANTHROPIC_API_KEY, CHANNEL3_API_KEY } = readConfig(["ANTHROPIC_API_KEY", "CHANNEL3_API_KEY"]);
  const channel3 = liveChannel3Transport(CHANNEL3_API_KEY);
  const seller = liveSellerTransport(ANTHROPIC_API_KEY);
  const searches: Record<string, { products: unknown[] }> = {};
  const replies: Record<string, Anthropic.Beta.Messages.BetaMessage[]> = {};
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const sample of SELL_SAMPLES) {
    const bytes = await readPublicPhoto(sample.src);
    const key = sha256(bytes);
    const searchStarted = Date.now();
    const response = trimmed(await channel3.searchByImage(bytes.toString("base64"), key));
    const searchMs = Date.now() - searchStarted;
    searches[key] = response;
    const { candidates } = candidatesFrom(response);
    const withPhotos = await Promise.all(candidates.map(async (candidate) => ({ candidate, photo: candidate.imageUrl === null ? null : await fetchProductPhoto(candidate.imageUrl) })));
    const started = Date.now();
    const result = await describeListing(
      {
        send: async (request, call) => {
          const reply = await seller.send(request, call);
          replies[key] = [...(call === 1 ? [] : (replies[key] ?? [])), reply];
          return reply;
        },
      },
      photoData(bytes, "image/jpeg"),
      withPhotos,
    );
    calls += result.usage.calls;
    inputTokens += result.usage.inputTokens;
    outputTokens += result.usage.outputTokens;
    if (!result.ok) {
      console.log(`${sample.slug}: failed. ${result.error}`);
      continue;
    }
    const built = draftDetailsFrom(result.verdict, candidates, { model: result.model, attempts: result.attempts });
    const summary = built.ok
      ? `${built.details.title}, ${built.details.conditionGrade}, ${formatUsdShort(built.details.priceCents)} floor ${formatUsdShort(built.details.floorPriceCents)}, new ${formatUsdShort(built.details.newPriceCents)} from ${built.details.newPriceSource}${built.details.match === null ? ", no match" : `, match ${built.details.match.title}`}`
      : built.reason;
    console.log(`${sample.slug}: Channel3 ${candidates.length} candidates in ${searchMs} ms, seller agent ${result.attempts} call(s) in ${Date.now() - started} ms. ${summary}`);
  }

  await writeFile(CHANNEL3_OUT, `${JSON.stringify({ version: 1, photos: searches }, null, 1)}\n`);
  await writeFile(SELLER_OUT, `${JSON.stringify({ version: 1, photos: replies }, null, 1)}\n`);
  console.log(JSON.stringify({ channel3Credits: SELL_SAMPLES.length, claudeCalls: calls, inputTokens, outputTokens }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
