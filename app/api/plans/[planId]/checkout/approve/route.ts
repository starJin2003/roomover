import type { NextRequest } from "next/server";
import { z } from "zod";
import { publish } from "@/lib/agents/bus";
import { loadPlanView } from "@/lib/agents/buyer/run";
import { approveCheckout, CheckoutFailed } from "@/lib/checkout/approve";
import { readConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { latestRun, loadPayablePlan, loadPresetsWithRules } from "@/lib/db/plans";
import { jsonResponse, planIdSchema, readBody, sessionFrom } from "@/lib/http";
import { paypalSdk } from "@/lib/paypal/server-sdk/client";

const bodySchema = z.strictObject({ orderId: z.string().regex(/^[A-Z0-9]{8,36}$/, "Expected a PayPal order ID") });

const STATUS: Readonly<Record<CheckoutFailed["code"], number>> = {
  not_found: 404,
  declined: 402,
  expired: 410,
  not_approved: 409,
  taken: 409,
  failed: 502,
};

/**
 * The PayPal button's onApprove. The server authorizes or captures the
 * order, records the IDs, and reserves the listings, then answers with the
 * plan as it now stands.
 */
export async function POST(request: NextRequest, context: RouteContext<"/api/plans/[planId]/checkout/approve">): Promise<Response> {
  const { planId } = await context.params;
  if (!planIdSchema.safeParse(planId).success) return jsonResponse(404, { error: "No such plan." });
  const session = sessionFrom(request);
  const body = await readBody(request, bodySchema);
  if (!body.ok) return body.response;
  const db = getDb();
  const plan = await loadPayablePlan(db, planId, session);
  if (plan === null) return jsonResponse(404, { error: "No such plan." });

  try {
    const result = await approveCheckout({ db, sdk: paypalSdk(), appUrl: readConfig(["APP_URL"]).APP_URL, now: new Date() }, { planId, paypalOrderId: body.data.orderId });
    for (const event of result.events) publish(planId, { type: "event", event });
    const preset = (await loadPresetsWithRules(db)).find((candidate) => candidate.id === plan.roomPresetId);
    const latest = await loadPayablePlan(db, planId, session);
    if (preset === undefined || latest === null) return jsonResponse(500, { error: "The plan could not be read after payment." });
    const view = await loadPlanView(db, latest, preset, await latestRun(db, planId));
    publish(planId, { type: "plan", plan: view });
    if (result.order.status === "capture_declined") {
      return jsonResponse(402, { code: "declined", error: "PayPal declined the payment, so nothing was charged. Press PayPal again and choose another way to pay.", plan: view });
    }
    return jsonResponse(200, { plan: view, events: result.events });
  } catch (error) {
    if (error instanceof CheckoutFailed) return jsonResponse(STATUS[error.code], { code: error.code, error: error.message });
    throw error;
  }
}
