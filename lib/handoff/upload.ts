import type { PhotoInput } from "./check";

export type ImageType = Extract<PhotoInput, { kind: "upload" }>["contentType"];

/** Phones resize before upload, so 5 MB leaves room for an unresized photo from a desktop. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** The image type from the file's first bytes, never from the name or the browser's claim. */
export function sniffImage(bytes: Buffer): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}
