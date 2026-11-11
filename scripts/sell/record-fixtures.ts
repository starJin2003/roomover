import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { chromium } from "@playwright/test";
import { MAX_EDGE, QUALITY } from "@/components/photos/prepare-photo";
import { readReplyRecording, type ReplyRecording } from "@/lib/agents/recording";
import { describeListing, liveSellerTransport } from "@/lib/agents/seller/describe";
import { photoData, readPublicPhoto, sha256 } from "@/lib/agents/verifier/facts";
import { candidatesFrom } from "@/lib/channel3/products";
import { liveChannel3Transport, readChannel3Recording, type Channel3Recording } from "@/lib/channel3/transport";
import { readConfig } from "@/lib/config";
import { draftDetailsFrom } from "@/lib/domain/sell";
import { formatUsdShort } from "@/lib/format";
import { fetchProductPhoto } from "@/lib/sell/photos";
import { SELL_SAMPLES } from "@/lib/sell/samples";

/**
 * Runs Channel3's image search and the live seller agent over every Sell
 * sample photo, prints what each one filled in, and saves both answers into
 * the fixtures the e2e tests replay, next to the recordings already there.
 * Each photo costs one Channel3 credit and one or two Claude calls.
 *
 * With --upload, it records one photo file as the Sell page uploads it,
 * shrunk and saved as JPEG by Chromium the way the browser does before
 * sending, so an e2e test that uploads the same file replays this answer.
 *
 *   pnpm sell:record-fixtures
 *   pnpm sell:record-fixtures --upload public/sell-samples/black-rolling-cart.jpg
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

const GPU = process.platform === "darwin" ? ["--use-angle=metal", "--ignore-gpu-blocklist"] : ["--ignore-gpu-blocklist"];

/** The bytes the Sell page sends for a photo file, from the same steps as preparePhoto in the same Chromium the e2e tests run. */
async function preparedLikeBrowser(file: Buffer): Promise<Buffer> {
  const browser = await chromium.launch({ args: GPU });
  try {
    const page = await browser.newPage();
    const base64 = await page.evaluate(
      async ({ source, maxEdge, quality }) => {
        const blob = await (await fetch(`data:image/jpeg;base64,${source}`)).blob();
        const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob((out) => (out === null ? reject(new Error("encode failed")) : resolve(out)), "image/jpeg", quality));
        const bytes = new Uint8Array(await jpeg.arrayBuffer());
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary);
      },
      { source: file.toString("base64"), maxEdge: MAX_EDGE, quality: QUALITY },
    );
    return Buffer.from(base64, "base64");
  } finally {
    await browser.close();
  }
}

async function photosToRecord(): Promise<{ label: string; bytes: Buffer }[]> {
  const index = process.argv.indexOf("--upload");
  const upload = index < 0 ? undefined : process.argv[index + 1];
  if (upload === undefined) return Promise.all(SELL_SAMPLES.map(async (sample) => ({ label: sample.slug, bytes: await readPublicPhoto(sample.src) })));
  return [{ label: `${basename(upload)} as uploaded`, bytes: await preparedLikeBrowser(await readFile(upload)) }];
}

async function main() {
  const { ANTHROPIC_API_KEY, CHANNEL3_API_KEY } = readConfig(["ANTHROPIC_API_KEY", "CHANNEL3_API_KEY"]);
  const channel3 = liveChannel3Transport(CHANNEL3_API_KEY);
  const seller = liveSellerTransport(ANTHROPIC_API_KEY);
  // Both files are checked, then merged as written, so the recordings already there stay byte for byte.
  await Promise.all([readChannel3Recording(CHANNEL3_OUT), readReplyRecording(SELLER_OUT)]);
  const channel3Recording = JSON.parse(await readFile(CHANNEL3_OUT, "utf8")) as Channel3Recording;
  const sellerRecording = JSON.parse(await readFile(SELLER_OUT, "utf8")) as ReplyRecording;
  const searches: Record<string, { products: unknown[] }> = { ...channel3Recording.photos };
  const replies: Record<string, unknown[]> = { ...sellerRecording.photos };
  const photos = await photosToRecord();
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const { label, bytes } of photos) {
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
          const reply: Anthropic.Beta.Messages.BetaMessage = await seller.send(request, call);
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
      console.log(`${label}: failed. ${result.error}`);
      continue;
    }
    const built = draftDetailsFrom(result.verdict, candidates, { model: result.model, attempts: result.attempts });
    const summary = built.ok
      ? `${built.details.title}, ${built.details.conditionGrade}, ${formatUsdShort(built.details.priceCents)} floor ${formatUsdShort(built.details.floorPriceCents)}, new ${formatUsdShort(built.details.newPriceCents)} from ${built.details.newPriceSource}${built.details.match === null ? ", no match" : `, match ${built.details.match.title}`}${built.details.similar == null ? "" : `, similar ${built.details.similar.products.map((product) => `${product.title} ${formatUsdShort(product.newPriceCents)}`).join("; ")}`}`
      : built.reason;
    console.log(`${label} (${key.slice(0, 12)}): Channel3 ${candidates.length} candidates in ${searchMs} ms, seller agent ${result.attempts} call(s) in ${Date.now() - started} ms. ${summary}`);
  }

  await writeFile(CHANNEL3_OUT, `${JSON.stringify({ ...channel3Recording, photos: searches }, null, 1)}\n`);
  await writeFile(SELLER_OUT, `${JSON.stringify({ ...sellerRecording, photos: replies }, null, 1)}\n`);
  console.log(JSON.stringify({ channel3Credits: photos.length, claudeCalls: calls, inputTokens, outputTokens }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
