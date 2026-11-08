import { createHash } from "node:crypto";

const NAMESPACE = "5af5f587-738a-4640-aa0b-0b34712d0a85";

/**
 * A name based UUID (version 5, RFC 9562) for a seed record. The same kind
 * and slug always give the same ID, so every seed run upserts the same rows.
 */
export function seedId(kind: string, slug: string): string {
  const namespace = Buffer.from(NAMESPACE.replaceAll("-", ""), "hex");
  const bytes = createHash("sha1").update(namespace).update(`${kind}/${slug}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
