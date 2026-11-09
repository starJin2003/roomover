import type { NextRequest } from "next/server";
import { z } from "zod";
import { jsonResponse, readBody } from "@/lib/http";
import { listInputSchema } from "@/lib/domain/sell";
import { listFromDraft } from "@/lib/sell/list";
import { sellDepsFrom, sellFailure, sellViewResponse } from "@/lib/sell/http";

const draftIdSchema = z.uuid();

/** Lists a filled in draft. The listing joins the catalog the buyer agent searches at once. */
export async function POST(request: NextRequest, context: RouteContext<"/api/sell/drafts/[draftId]/listing">): Promise<Response> {
  const { draftId } = await context.params;
  const deps = await sellDepsFrom(request);
  if (deps instanceof Response) return deps;
  if (!draftIdSchema.safeParse(draftId).success) return jsonResponse(404, { error: "That photo is not one of yours." });
  const body = await readBody(request, listInputSchema);
  if (!body.ok) return body.response;
  try {
    await listFromDraft(deps, draftId, body.data);
  } catch (error) {
    return sellFailure(deps, error);
  }
  return sellViewResponse(deps, 201);
}
