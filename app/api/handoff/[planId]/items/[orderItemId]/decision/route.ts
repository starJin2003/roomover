import type { NextRequest } from "next/server";
import { z } from "zod";
import { HANDOFF_CHOICES } from "@/lib/domain/money-policy";
import { confirmChoice } from "@/lib/handoff/check";
import { handoffFailure, handoffRequest, viewResponse } from "@/lib/handoff/http";
import { jsonResponse, readBody } from "@/lib/http";

const itemIdSchema = z.uuid();
const bodySchema = z.strictObject({ choice: z.enum(HANDOFF_CHOICES) });

/** The student's one tap that confirms an item. Money moves once every item is confirmed. */
export async function POST(request: NextRequest, context: RouteContext<"/api/handoff/[planId]/items/[orderItemId]/decision">): Promise<Response> {
  const { planId, orderItemId } = await context.params;
  const handoff = await handoffRequest(request, planId);
  if (handoff instanceof Response) return handoff;
  if (!itemIdSchema.safeParse(orderItemId).success) return jsonResponse(404, { error: "That item is not part of this handoff." });
  const body = await readBody(request, bodySchema);
  if (!body.ok) return body.response;
  try {
    await confirmChoice({ db: handoff.db, sessionId: handoff.sessionId, now: () => new Date() }, planId, orderItemId, body.data.choice);
  } catch (error) {
    return handoffFailure(handoff, error);
  }
  return viewResponse(handoff);
}
