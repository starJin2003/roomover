import { readPublicPhoto } from "@/lib/agents/verifier/facts";
import type { PhotoData } from "@/lib/agents/verifier/prompt";
import type { Database } from "@/lib/db/client";
import { LISTING_PHOTO_PATH, loadListingPhoto } from "@/lib/db/sell";
import { MAX_PHOTO_BYTES, sniffImage } from "@/lib/images";

/**
 * The bytes behind a listing photo. Seed and sample photos are committed
 * JPEGs, and photos sellers took on Sell live in Postgres. The verifier reads
 * listing photos through here, so it checks Sell items like seeded ones.
 */
export async function listingPhotoBytes(db: Database, src: string): Promise<{ bytes: Buffer; data: PhotoData }> {
  if (src.startsWith(LISTING_PHOTO_PATH)) {
    const photo = await loadListingPhoto(db, src.slice(LISTING_PHOTO_PATH.length));
    if (photo === null) throw new RangeError(`Listing photo ${src} is gone.`);
    return { bytes: photo.bytes, data: { mediaType: photo.contentType as PhotoData["mediaType"], base64: photo.bytes.toString("base64") } };
  }
  const bytes = await readPublicPhoto(src);
  return { bytes, data: { mediaType: "image/jpeg", base64: bytes.toString("base64") } };
}

const FETCH_TIMEOUT_MS = 5_000;

/**
 * A Channel3 product photo for the seller agent to compare against. The
 * photos sit on Channel3's CDN. A photo that is slow, too large, or not an
 * image is left out, and the agent compares that candidate by its words.
 */
export async function fetchProductPhoto(url: string): Promise<PhotoData | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" });
    if (!response.ok) return null;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_PHOTO_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    const type = bytes.length <= MAX_PHOTO_BYTES ? sniffImage(bytes) : null;
    return type === null ? null : { mediaType: type, base64: bytes.toString("base64") };
  } catch {
    return null;
  }
}
