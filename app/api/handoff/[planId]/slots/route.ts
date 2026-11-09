import type { NextRequest } from "next/server";
import { z } from "zod";
import { roomLabel } from "@/lib/agents/buyer/run";
import { handoffFailure, handoffRequest } from "@/lib/handoff/http";
import { layoutRefs, loadHandoffView } from "@/lib/handoff/load";
import { moveSlot } from "@/lib/handoff/slots";
import { scheduleWords } from "@/lib/handoff/view";
import { firstNameOf } from "@/lib/handoff/words";
import { jsonResponse, readBody } from "@/lib/http";

const bodySchema = z.strictObject({
  orderItemIds: z.array(z.uuid()).min(1).max(8),
  startsAt: z.iso.datetime({ offset: true }),
});

/**
 * Moves the handoff slot of one seller's items to another two hours. The
 * answer carries the sentence the schedule shows and the handoff as it
 * stands, and a refused move answers with the reason and the unchanged view.
 * No PayPal call happens here.
 */
export async function POST(request: NextRequest, context: RouteContext<"/api/handoff/[planId]/slots">): Promise<Response> {
  const { planId } = await context.params;
  const handoff = await handoffRequest(request, planId);
  if (handoff instanceof Response) return handoff;
  const body = await readBody(request, bodySchema);
  if (!body.ok) return body.response;
  const words = { layout: layoutRefs(handoff.plan), roomLabel: roomLabel(handoff.preset, handoff.plan.roomNumber), buyerFirstName: firstNameOf(handoff.plan.buyerName) };
  let sentence: string;
  try {
    ({ sentence } = await moveSlot({ db: handoff.db, now: () => new Date() }, { planId, orderItemIds: body.data.orderItemIds, startsAt: new Date(body.data.startsAt) }, (order) => scheduleWords(order, words)));
  } catch (error) {
    const refused = await handoffFailure(handoff, error);
    const answer = (await refused.json()) as { error?: string };
    const view = await loadHandoffView(handoff.db, handoff.plan, handoff.preset);
    return jsonResponse(refused.status, { error: answer.error, view });
  }
  const view = await loadHandoffView(handoff.db, handoff.plan, handoff.preset);
  return view === null ? jsonResponse(404, { error: "This room has no paid order to hand off." }) : jsonResponse(200, { view, sentence });
}
