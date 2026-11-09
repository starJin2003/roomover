import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { loadHandoffOrder } from "@/lib/db/handoffs";
import { loadSessionPlan } from "@/lib/db/plans";
import { canCheck } from "@/lib/domain/order-state";
import { releaseOrder } from "@/lib/handoff/release";
import { jsonResponse, planIdSchema, sessionFrom } from "@/lib/http";
import { PayPalApiError } from "@/lib/paypal/errors";
import { paypalSdk } from "@/lib/paypal/server-sdk/client";

/**
 * Start a new plan on a paid room. PayPal gives the hold back at once (a
 * refund in capture mode) and the listings go back on sale. A room whose
 * handoff already settled keeps its order, and the answer says so.
 */
export async function POST(request: NextRequest, context: RouteContext<"/api/plans/[planId]/release">): Promise<Response> {
  const { planId } = await context.params;
  const session = sessionFrom(request);
  if (session === null || !planIdSchema.safeParse(planId).success) return jsonResponse(404, { error: "No such plan." });
  const db = getDb();
  const plan = await loadSessionPlan(db, planId, session);
  if (plan === null) return jsonResponse(404, { error: "No such plan." });
  const order = await loadHandoffOrder(db, planId);
  if (order === null || !canCheck(order.status)) return jsonResponse(200, { released: false });
  try {
    const released = await releaseOrder({ db, sdk: paypalSdk(), now: () => new Date() }, order.id, "new_plan");
    return jsonResponse(200, { released });
  } catch (error) {
    if (!(error instanceof PayPalApiError)) throw error;
    console.error("release: PayPal did not release the hold", { planId, status: error.status, debugId: error.debugId });
    return jsonResponse(502, { error: "PayPal did not release your hold just now. Try again in a moment." });
  }
}
