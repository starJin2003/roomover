import type { NextRequest } from "next/server";
import { roomLabel } from "@/lib/agents/buyer/run";
import { handoffFailure, handoffRequest, viewResponse } from "@/lib/handoff/http";
import { layoutRefs } from "@/lib/handoff/load";
import { settleHandoff } from "@/lib/handoff/settle";
import { paypalRest } from "@/lib/paypal/rest/client";
import { paypalSdk } from "@/lib/paypal/server-sdk/client";

/**
 * Moves the money for a checked handoff: captures or refunds per item, a
 * void when nothing was kept, and one payout batch. The screen calls it
 * after the last confirmation and again from Try again, and a second call
 * carries on from where the first stopped.
 */
export async function POST(request: NextRequest, context: RouteContext<"/api/handoff/[planId]/settle">): Promise<Response> {
  const handoff = await handoffRequest(request, (await context.params).planId);
  if (handoff instanceof Response) return handoff;
  try {
    await settleHandoff({ db: handoff.db, sdk: paypalSdk(), rest: paypalRest(), now: () => new Date() }, handoff.plan.id, roomLabel(handoff.preset, handoff.plan.roomNumber), layoutRefs(handoff.plan));
  } catch (error) {
    return handoffFailure(handoff, error);
  }
  return viewResponse(handoff);
}
