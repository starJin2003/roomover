import { connection, type NextRequest } from "next/server";
import { publish } from "@/lib/agents/bus";
import { loadPlanView } from "@/lib/agents/buyer/run";
import { approveCheckout, CheckoutFailed } from "@/lib/checkout/approve";
import { readConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { currentOrder } from "@/lib/db/orders";
import { latestRun, loadPresetsWithRules, loadSharedPlan } from "@/lib/db/plans";
import { previewPath } from "@/lib/domain/mcp";
import { planIdSchema } from "@/lib/http";
import { paypalSdk } from "@/lib/paypal/server-sdk/client";
import { absoluteUrl } from "@/lib/site";

const PAYPAL_ORDER_ID = /^[A-Z0-9]{8,36}$/;

const back = (appUrl: string, planId: string, code?: string) =>
  Response.redirect(absoluteUrl(appUrl, `${previewPath(planId)}${code === undefined ? "" : `?paypal=${code}`}`), 303);

/**
 * Where PayPal sends the student after they approve a plan an outside
 * assistant prepared. The order to approve comes from the plan's own record,
 * and PayPal's token, when present, has to name the same order. The existing
 * approval path then authorizes or captures it, and the student lands back
 * on the preview page with the payment held.
 */
export async function GET(request: NextRequest, context: RouteContext<"/p/[planId]/approved">): Promise<Response> {
  await connection();
  const { planId } = await context.params;
  const { APP_URL } = readConfig(["APP_URL"]);
  if (!planIdSchema.safeParse(planId).success) return Response.redirect(absoluteUrl(APP_URL, "/"), 303);
  const db = getDb();
  const plan = await loadSharedPlan(db, planId);
  if (plan === null) return back(APP_URL, planId);

  const order = await currentOrder(db, planId);
  const token = request.nextUrl.searchParams.get("token");
  const paypalOrderId = token !== null && PAYPAL_ORDER_ID.test(token) ? token : order?.paypalOrderId;
  if (paypalOrderId === null || paypalOrderId === undefined) return back(APP_URL, planId, "not_found");

  try {
    const result = await approveCheckout({ db, sdk: paypalSdk(), appUrl: APP_URL, now: new Date() }, { planId, paypalOrderId });
    for (const event of result.events) publish(planId, { type: "event", event });
    const preset = (await loadPresetsWithRules(db)).find((candidate) => candidate.id === plan.roomPresetId);
    const latest = await loadSharedPlan(db, planId);
    if (preset !== undefined && latest !== null) publish(planId, { type: "plan", plan: await loadPlanView(db, latest, preset, await latestRun(db, planId)) });
    return back(APP_URL, planId, result.order.status === "capture_declined" ? "declined" : undefined);
  } catch (error) {
    if (error instanceof CheckoutFailed) return back(APP_URL, planId, error.code);
    throw error;
  }
}
