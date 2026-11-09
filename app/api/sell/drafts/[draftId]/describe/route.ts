import type { NextRequest } from "next/server";
import { z } from "zod";
import { jsonResponse } from "@/lib/http";
import { describeDraft } from "@/lib/sell/analyze";
import { sellDepsFrom, sellFailure, sellViewResponse } from "@/lib/sell/http";

const draftIdSchema = z.uuid();

/** The seller agent reads the photo against Channel3's candidates and fills in the listing before answering. */
export async function POST(request: NextRequest, context: RouteContext<"/api/sell/drafts/[draftId]/describe">): Promise<Response> {
  const { draftId } = await context.params;
  const deps = await sellDepsFrom(request);
  if (deps instanceof Response) return deps;
  if (!draftIdSchema.safeParse(draftId).success) return jsonResponse(404, { error: "That photo is not one of yours." });
  try {
    await describeDraft(deps, draftId);
  } catch (error) {
    return sellFailure(deps, error);
  }
  return sellViewResponse(deps);
}
