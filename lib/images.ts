/** The photo types Roomover accepts from students, for handoffs and listings. */
export type ImageType = "image/jpeg" | "image/png" | "image/webp";

/** Phones resize before upload, so 5 MB leaves room for an unresized photo from a desktop. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** The image type from the file's first bytes, never from the name or the browser's claim. */
export function sniffImage(bytes: Buffer): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export interface PixelSize {
  widthPx: number;
  heightPx: number;
}

/** JPEG start of frame markers carry the size. 0xC4, 0xC8, and 0xCC share the range but are tables. */
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegSize(bytes: Buffer): PixelSize | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (JPEG_FRAMES.has(marker)) return { heightPx: bytes.readUInt16BE(offset + 5), widthPx: bytes.readUInt16BE(offset + 7) };
    offset += 2 + length;
  }
  return null;
}

function webpSize(bytes: Buffer): PixelSize | null {
  const chunk = bytes.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X" && bytes.length >= 30) return { widthPx: 1 + bytes.readUIntLE(24, 3), heightPx: 1 + bytes.readUIntLE(27, 3) };
  if (chunk === "VP8 " && bytes.length >= 30) return { widthPx: bytes.readUInt16LE(26) & 0x3fff, heightPx: bytes.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L" && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21);
    return { widthPx: (bits & 0x3fff) + 1, heightPx: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** The pixel size from the header, or null when the header is not one Roomover reads. */
export function imageSize(bytes: Buffer, type: ImageType): PixelSize | null {
  const size = type === "image/jpeg" ? jpegSize(bytes) : type === "image/png" ? (bytes.length >= 24 ? { widthPx: bytes.readUInt32BE(16), heightPx: bytes.readUInt32BE(20) } : null) : webpSize(bytes);
  return size !== null && size.widthPx > 0 && size.heightPx > 0 ? size : null;
}
