import { RunLimitError, SELL_LIMITS, decideLimit } from "@/lib/agents/limits";
import { describeListing, sellerTransportFor } from "@/lib/agents/seller/describe";
import { readPublicPhoto, sha256 } from "@/lib/agents/verifier/facts";
import { Channel3Unavailable, identifyProductByImage } from "@/lib/channel3/identify";
import { channel3Transport } from "@/lib/channel3/transport";
import type { Database } from "@/lib/db/client";
import { claudeCallsToday, lockRunLimits, windowCount } from "@/lib/db/plans";
import type { SellerProfile } from "@/lib/db/sellers";
import { draftsToday, insertDraft, insertListingPhoto, LISTING_PHOTO_PATH, loadDraft, markDescribeStarted, recordDescribe, reserveSellerCalls, sellerCallsForDraft, settleSellerCalls, storedSellPhotoBytes, type DraftRow } from "@/lib/db/sell";
import { draftDetailsFrom, type Channel3Lookup } from "@/lib/domain/sell";
import { imageSize, type ImageType } from "@/lib/images";
import { fetchProductPhoto, listingPhotoBytes } from "./photos";
import { sellSample } from "./samples";

const HOUR_MS = 60 * 60 * 1000;

export interface SellDeps {
  db: Database;
  now: () => Date;
  sessionId: string;
  clientHash: string;
  seller: SellerProfile;
}

/** Why a Sell step was refused, with a sentence for the seller and an HTTP status for the route. */
export class SellRefused extends Error {
  constructor(
    readonly status: 404 | 409 | 422 | 429 | 507,
    message: string,
  ) {
    super(message);
    this.name = "SellRefused";
  }
}

export type SellPhotoInput = { kind: "upload"; bytes: Buffer; contentType: ImageType } | { kind: "sample"; slug: string };

/**
 * Takes the seller's photo and asks Channel3 which retail product it shows.
 * The draft starts with Channel3's answer, so the panel can say what it
 * found before the seller agent reads the photo. When Channel3 cannot answer,
 * the draft carries the reason and the seller enters the size by hand. A
 * browser starts at most 20 photos a day, and uploads stop once stored Sell
 * photos pass 300 MB, while sample photos keep working.
 */
export async function startDraft(deps: SellDeps, input: SellPhotoInput): Promise<string> {
  if ((await draftsToday(deps.db, deps.sessionId, deps.now())) >= SELL_LIMITS.draftsPerSessionPerDay) {
    throw new SellRefused(429, `This browser started ${SELL_LIMITS.draftsPerSessionPerDay} Sell photos today, the most the demo allows, and it can start more after midnight UTC.`);
  }
  if (input.kind === "upload" && (await storedSellPhotoBytes(deps.db)) >= SELL_LIMITS.storedPhotoBytes) {
    throw new SellRefused(507, "The demo holds 300 MB of Sell photos right now, so new uploads pause until older ones clear, and the sample photos still work.");
  }
  let bytes: Buffer;
  let photoId: string | null = null;
  let sampleSrc: string | null = null;
  if (input.kind === "sample") {
    const sample = sellSample(input.slug);
    if (sample === undefined) throw new SellRefused(422, "Choose one of the sample photos shown.");
    sampleSrc = sample.src;
    bytes = await readPublicPhoto(sample.src);
  } else {
    bytes = input.bytes;
    const size = imageSize(bytes, input.contentType);
    if (size === null) throw new SellRefused(422, "Roomover could not read that photo. Take it again, or use a sample photo.");
    photoId = await insertListingPhoto(deps.db, { sellerId: deps.seller.id, sessionId: deps.sessionId, contentType: input.contentType, bytes, sha256: sha256(bytes), ...size });
  }
  const photoSha256 = sha256(bytes);

  let channel3: Channel3Lookup;
  try {
    channel3 = await identifyProductByImage({ db: deps.db, transport: channel3Transport(), now: deps.now, sessionId: deps.sessionId }, { sha256: photoSha256, base64: bytes.toString("base64") });
  } catch (error) {
    if (!(error instanceof Channel3Unavailable) && !(error instanceof RunLimitError)) throw error;
    channel3 = { candidates: [], credits: 0, cached: false, latencyMs: 0, unavailable: error.message };
  }
  return insertDraft(deps.db, { sellerId: deps.seller.id, sessionId: deps.sessionId, clientHash: deps.clientHash, sampleSrc, photoId, photoSha256, channel3 });
}

const describing = ((globalThis as typeof globalThis & { roomoverDescribing?: Set<string> }).roomoverDescribing ??= new Set<string>());

/** Where a draft's photo is read and shown: the sample's public path, or the stored upload's route. */
export function draftPhotoSrc(draft: Pick<DraftRow, "sampleSrc" | "photoId">): string {
  return draft.sampleSrc ?? `${LISTING_PHOTO_PATH}${draft.photoId}`;
}

/**
 * The seller agent reads the photo against Channel3's candidates and fills
 * in the listing. A live run counts against the same hourly and daily limits
 * as the buyer agent, under the same lock, and reserves the calls the photo
 * has left (two across all its tries) at the time it starts. The answer, or
 * a visible failure the seller can retry while calls remain, is stored
 * before this returns.
 */
export async function describeDraft(deps: SellDeps, draftId: string): Promise<void> {
  const draft = await loadDraft(deps.db, draftId, deps.seller.id);
  if (draft === null) throw new SellRefused(404, "That photo is not one of yours.");
  if (draft.status === "ready" || draft.status === "listed") return;
  if (describing.has(draftId)) throw new SellRefused(409, "The seller agent is already reading this photo.");
  describing.add(draftId);
  try {
    const { mode, transport } = await sellerTransportFor(draft.photoSha256);
    const now = deps.now();
    let callsLeft: number = SELL_LIMITS.callsPerDraft;
    let reservation: string | null = null;
    await deps.db.transaction(async (tx) => {
      if (mode === "live") {
        await lockRunLimits(tx);
        callsLeft = SELL_LIMITS.callsPerDraft - (await sellerCallsForDraft(tx, draftId));
        if (callsLeft <= 0) throw new SellRefused(429, "The seller agent already read this photo twice, the most the demo allows for one photo, so take a new photo to try again.");
        const since = new Date(now.getTime() - HOUR_MS);
        const decision = decideLimit(
          { session: await windowCount(tx, "session", deps.sessionId, since), client: await windowCount(tx, "client", deps.clientHash, since), claudeCallsToday: await claudeCallsToday(tx, now) },
          callsLeft,
          now,
        );
        if (!decision.allowed) throw new RunLimitError(decision);
        reservation = await reserveSellerCalls(tx, { draftId, sessionId: deps.sessionId, clientHash: deps.clientHash, calls: callsLeft, at: now });
      }
      await markDescribeStarted(tx, draftId, mode);
    });

    let spent = 0;
    try {
      const photo = (await listingPhotoBytes(deps.db, draftPhotoSrc(draft))).data;
      const candidates = await Promise.all(
        draft.channel3.candidates.map(async (candidate) => ({ candidate, photo: mode === "live" && candidate.imageUrl !== null ? await fetchProductPhoto(candidate.imageUrl) : null })),
      );
      const started = Date.now();
      let result: Awaited<ReturnType<typeof describeListing>>;
      try {
        result = await describeListing(transport, photo, candidates, callsLeft);
      } catch (error) {
        console.error("seller agent call failed", { draftId, error: error instanceof Error ? error.name : "unknown" });
        result = { ok: false, error: "The seller agent could not reach Claude just now. Try again in a moment.", usage: { calls: mode === "live" ? 1 : 0, inputTokens: 0, outputTokens: 0 } };
      }
      const usage = { calls: mode === "live" ? result.usage.calls : 0, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, describeMs: Date.now() - started };
      spent = usage.calls;
      if (!result.ok) {
        await recordDescribe(deps.db, draftId, { status: "failed", error: result.error, ...usage });
        return;
      }
      const built = draftDetailsFrom(result.verdict, draft.channel3.candidates, { model: result.model, attempts: result.attempts });
      await recordDescribe(deps.db, draftId, built.ok ? { status: "ready", details: built.details, ...usage } : { status: "failed", error: built.reason, ...usage });
    } finally {
      if (reservation !== null) await settleSellerCalls(deps.db, reservation, spent);
    }
  } finally {
    describing.delete(draftId);
  }
}
