import type { NextRequest } from "next/server";
import { prepareCheckout } from "@/lib/checkout/prepare";
import { readConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { insertOrderEvents } from "@/lib/db/orders";
import { latestRun, loadPayablePlan } from "@/lib/db/plans";
import { publish } from "@/lib/agents/bus";
import { CheckoutRefused } from "@/lib/domain/checkout";
import { formatUsdShort } from "@/lib/format";
import { jsonResponse, planIdSchema, sessionFrom } from "@/lib/http";
import { PayPalApiError } from "@/lib/paypal/errors";
import { paypalSdk } from "@/lib/paypal/server-sdk/client";

/**
 * The PayPal button's createOrder. It answers with the order the buyer
 * agent prepared when that order still matches the room, and prepares a
 * fresh one otherwise, so the student always approves what the room holds.
 */
export async function POST(request: NextRequest, context: RouteContext<"/api/plans/[planId]/checkout">): Promise<Response> {
  const { planId } = await context.params;
  if (!planIdSchema.safeParse(planId).success) return jsonResponse(404, { error: "No such plan." });
  const db = getDb();
  // The browser's own plan, or one an outside assistant shared through its preview link.
  const plan = await loadPayablePlan(db, planId, sessionFrom(request));
  if (plan === null) return jsonResponse(404, { error: "No such plan." });
  if ((await latestRun(db, planId))?.status === "running") return jsonResponse(409, { error: "The buyer agent is still working on this room. Pay when it finishes." });

  try {
    const prepared = await prepareCheckout({ db, sdk: paypalSdk(), appUrl: readConfig(["APP_URL"]).APP_URL, now: new Date() }, plan);
    if (prepared.created) {
      const total = formatUsdShort(prepared.checkout.totalCents);
      const events = await insertOrderEvents(db, prepared.order, "platform", [
        {
          tool: "create_checkout",
          summary: `Created PayPal order ${prepared.paypalOrderId} for ${total} when the student pressed PayPal, because the room had no current order.`,
          detail: { totalCents: prepared.checkout.totalCents, paypalIdKind: "order" },
          paypal: { api: "Orders v2", id: prepared.paypalOrderId },
        },
      ]);
      for (const event of events) publish(planId, { type: "event", event });
    }
    return jsonResponse(200, { orderId: prepared.paypalOrderId });
  } catch (error) {
    if (error instanceof CheckoutRefused) return jsonResponse(error.reason === "paid" ? 409 : 422, { error: error.message, reason: error.reason });
    if (error instanceof PayPalApiError) {
      console.error("checkout: PayPal did not create the order", { planId, status: error.status, debugId: error.debugId });
      return jsonResponse(502, { error: "PayPal did not create the order. Nothing was charged. Try again in a moment." });
    }
    throw error;
  }
}
