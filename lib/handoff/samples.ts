/**
 * Sample handoff photos for judges without the item at hand. Each seed
 * listing has one, made from its own listing photo with a different crop
 * and light, and the mesh desk chair also has one with a new tear in the
 * seat. `pnpm handoff:samples` writes them to public/handoff-samples.
 */

export const SAMPLE_KINDS = ["as_listed", "torn"] as const;
export type SampleKind = (typeof SAMPLE_KINDS)[number];

const SAMPLE_DIR = "/handoff-samples";
const LISTING_PHOTO = /^\/seed\/listings\/([a-z0-9-]+)\.jpg$/;
const TORN = new Set(["marcus-mesh-desk-chair"]);

export interface SampleOption {
  kind: SampleKind;
  src: string;
}

/** The samples a listing offers, as listed first. Uploaded listings have none. */
export function samplesFor(listingPhotoSrc: string): SampleOption[] {
  const name = LISTING_PHOTO.exec(listingPhotoSrc)?.[1];
  if (name === undefined) return [];
  return [{ kind: "as_listed", src: `${SAMPLE_DIR}/${name}.jpg` }, ...(TORN.has(name) ? [{ kind: "torn" as const, src: `${SAMPLE_DIR}/${name}-torn.jpg` }] : [])];
}

export function sampleFor(listingPhotoSrc: string, kind: SampleKind): SampleOption | undefined {
  return samplesFor(listingPhotoSrc).find((sample) => sample.kind === kind);
}
