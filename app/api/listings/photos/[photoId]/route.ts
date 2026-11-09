import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { loadListingPhoto } from "@/lib/db/sell";
import { jsonResponse } from "@/lib/http";

const photoIdSchema = z.uuid();

/** A photo a seller took on Sell. Listing photos are public, like the committed seed photos. */
export async function GET(_request: NextRequest, context: RouteContext<"/api/listings/photos/[photoId]">): Promise<Response> {
  const { photoId } = await context.params;
  if (!photoIdSchema.safeParse(photoId).success) return jsonResponse(404, { error: "No such photo." });
  const photo = await loadListingPhoto(getDb(), photoId);
  if (photo === null) return jsonResponse(404, { error: "No such photo." });
  return new Response(new Uint8Array(photo.bytes), {
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(photo.bytes.length),
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      ETag: `"${photo.sha256}"`,
    },
  });
}
