import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { loadUploadedPhoto } from "@/lib/db/handoffs";
import { jsonResponse, sessionFrom } from "@/lib/http";

const photoIdSchema = z.uuid();

/**
 * One uploaded handoff photo, for the session that took it and nobody else.
 * There is no listing of photos, and another session asking gets the same
 * 404 as a photo that does not exist.
 */
export async function GET(request: NextRequest, context: RouteContext<"/api/handoff/photos/[photoId]">): Promise<Response> {
  const { photoId } = await context.params;
  const session = sessionFrom(request);
  if (session === null || !photoIdSchema.safeParse(photoId).success) return jsonResponse(404, { error: "No such photo." });
  const photo = await loadUploadedPhoto(getDb(), photoId, session);
  if (photo === null) return jsonResponse(404, { error: "No such photo." });
  return new Response(new Uint8Array(photo.bytes), {
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(photo.bytes.length),
      "Cache-Control": "private, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      ETag: `"${photo.sha256}"`,
    },
  });
}
