import type { NextRequest } from "next/server";
import { z } from "zod";
import { isPhotoUpload, jsonResponse, readBody, readPhotoUpload } from "@/lib/http";
import { startDraft, type SellPhotoInput } from "@/lib/sell/analyze";
import { currentSellView, sellDepsFrom, sellFailure } from "@/lib/sell/http";

const sampleBodySchema = z.strictObject({ sample: z.string().min(1).max(80) });

/**
 * Takes the seller's photo, from the camera, a file, or a sample, and runs
 * Channel3's image search on it before answering. The seller agent reads it
 * on the next call, so the screen can show Channel3's answer first.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const deps = await sellDepsFrom(request);
  if (deps instanceof Response) return deps;
  let input: SellPhotoInput;
  if (isPhotoUpload(request)) {
    const upload = await readPhotoUpload(request);
    if (upload instanceof Response) return upload;
    input = { kind: "upload", ...upload };
  } else {
    const body = await readBody(request, sampleBodySchema);
    if (!body.ok) return body.response;
    input = { kind: "sample", slug: body.data.sample };
  }
  try {
    const draftId = await startDraft(deps, input);
    return jsonResponse(201, { draftId, view: await currentSellView(deps) });
  } catch (error) {
    return sellFailure(deps, error);
  }
}
