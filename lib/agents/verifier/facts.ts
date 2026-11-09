import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConditionReport } from "@/lib/domain/listing";
import type { ListingFacts, PhotoData } from "./prompt";

export interface VerifiableListing {
  title: string;
  description: string;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  conditionReport: Pick<ConditionReport, "defects">;
}

export function listingFacts(listing: VerifiableListing): ListingFacts {
  return {
    title: listing.title,
    description: listing.description,
    sizeMm: [listing.widthMm, listing.depthMm, listing.heightMm],
    listedWear: listing.conditionReport.defects.map((defect) => `${defect.location}: ${defect.description}`),
  };
}

const PUBLIC_PHOTO = /^\/(seed\/listings|handoff-samples|sell-samples)\/[a-z0-9-]+\.jpg$/;

/** A JPEG committed under the public folder, such as a seed listing photo or a sample handoff or Sell photo. */
export async function readPublicPhoto(src: string): Promise<Buffer> {
  if (!PUBLIC_PHOTO.test(src)) throw new RangeError(`${src} is not a committed listing or sample photo.`);
  return readFile(join(process.cwd(), "public", src));
}

export function photoData(bytes: Buffer, mediaType: PhotoData["mediaType"]): PhotoData {
  return { mediaType, base64: bytes.toString("base64") };
}

export const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
