import type { NextRequest } from "next/server";
import { z } from "zod";
import { checkPhoto, type PhotoInput } from "@/lib/handoff/check";
import { handoffFailure, handoffRequest, viewResponse } from "@/lib/handoff/http";
import { SAMPLE_KINDS } from "@/lib/handoff/samples";
import { MAX_PHOTO_BYTES, sniffImage } from "@/lib/handoff/upload";
import { jsonResponse } from "@/lib/http";

const itemIdSchema = z.uuid();
const jsonBodySchema = z.union([z.strictObject({ sample: z.enum(SAMPLE_KINDS) }), z.strictObject({ retry: z.literal(true) })]);

async function readInput(request: NextRequest): Promise<PhotoInput | Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_PHOTO_BYTES + 64 * 1024) return jsonResponse(413, { error: "That photo is larger than 5 MB. Take it again at a smaller size." });
  if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    let file: FormDataEntryValue | null;
    try {
      file = (await request.formData()).get("photo");
    } catch {
      return jsonResponse(400, { error: "The photo did not arrive whole. Try again." });
    }
    if (!(file instanceof File)) return jsonResponse(400, { error: "Attach the photo as the photo field." });
    if (file.size === 0 || file.size > MAX_PHOTO_BYTES) return jsonResponse(413, { error: "That photo is empty or larger than 5 MB." });
    const bytes = Buffer.from(await file.arrayBuffer());
    const contentType = sniffImage(bytes);
    if (contentType === null) return jsonResponse(415, { error: "Roomover takes JPEG, PNG, or WebP photos." });
    return { kind: "upload", bytes, contentType };
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse(400, { error: "The request body is not JSON." });
  }
  const parsed = jsonBodySchema.safeParse(raw);
  if (!parsed.success) return jsonResponse(400, { error: z.prettifyError(parsed.error) });
  return "sample" in parsed.data ? { kind: "sample", sample: parsed.data.sample } : { kind: "retry" };
}

/**
 * Takes a handoff photo for one item, from the camera, a file, or a sample,
 * and runs the verifier on it before answering.
 */
export async function POST(request: NextRequest, context: RouteContext<"/api/handoff/[planId]/items/[orderItemId]/photo">): Promise<Response> {
  const { planId, orderItemId } = await context.params;
  const handoff = await handoffRequest(request, planId);
  if (handoff instanceof Response) return handoff;
  if (!itemIdSchema.safeParse(orderItemId).success) return jsonResponse(404, { error: "That item is not part of this handoff." });
  const input = await readInput(request);
  if (input instanceof Response) return input;
  try {
    await checkPhoto({ db: handoff.db, sessionId: handoff.sessionId, now: () => new Date() }, planId, orderItemId, input);
  } catch (error) {
    return handoffFailure(handoff, error);
  }
  return viewResponse(handoff);
}
