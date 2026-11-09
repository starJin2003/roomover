import { z } from "zod";
import type { Database } from "@/lib/db/client";
import { cancelPendingOrder, currentOrder, insertPendingOrder, loadCheckoutListings, setPayPalOrderId, type OrderWithLines } from "@/lib/db/orders";
import { buildCheckout, CheckoutRefused, intentFor, sameLines, type CheckoutPlan } from "@/lib/domain/checkout";
import type { OrderStatus } from "@/lib/domain/enums";
import type { PlanLayout } from "@/lib/domain/layout";
import { approvedPath, isSharedPlanSession, previewPath } from "@/lib/domain/mcp";
import { orderCreateKey } from "@/lib/paypal/idempotency";
import { retryTransient } from "@/lib/paypal/retry";
import type { PayPalSdk } from "@/lib/paypal/server-sdk/client";
import { approvalLink, createOrder, getOrder } from "@/lib/paypal/server-sdk/orders";
import { absoluteUrl } from "@/lib/site";

/**
 * PayPal keeps an unapproved order usable for 6 hours. Roomover prepares a
 * fresh one after 5, so a student never starts paying on one about to expire.
 */
const ORDER_REUSE_MS = 5 * 60 * 60 * 1000;

const createdOrderSchema = z.object({ id: z.string().min(1) });

const REPAYABLE_STATUSES: ReadonlySet<OrderStatus> = new Set(["pending_approval", "approved", "voided", "refunded"]);

export interface CheckoutDeps {
  db: Database;
  sdk: PayPalSdk;
  /** Return and cancel URLs for buyers who leave the popup for a full page. */
  appUrl: string;
  now: Date;
}

export interface PreparedCheckout {
  order: OrderWithLines;
  paypalOrderId: string;
  /** PayPal's approval link from the order PayPal just created. Null for a reused order. */
  approvalUrl: string | null;
  checkout: CheckoutPlan;
  /** False when the plan's existing order still fits and was handed back. */
  created: boolean;
}

export interface CheckoutPlanRef {
  id: string;
  buyerId: string;
  /** An MCP session's plan sends the student back to its preview page after PayPal. */
  sessionId: string | null;
  layout: PlanLayout;
}

/**
 * Where PayPal sends a buyer who leaves the popup for a full page. A plan an
 * outside assistant made is approved from its preview link, so PayPal
 * returns there, and the return route authorizes or captures the order.
 */
export function checkoutReturnUrls(appUrl: string, plan: Pick<CheckoutPlanRef, "id" | "sessionId">): { returnUrl: string; cancelUrl: string } {
  if (!isSharedPlanSession(plan.sessionId)) return { returnUrl: absoluteUrl(appUrl, "/furnish"), cancelUrl: absoluteUrl(appUrl, "/furnish") };
  return { returnUrl: absoluteUrl(appUrl, approvedPath(plan.id)), cancelUrl: absoluteUrl(appUrl, `${previewPath(plan.id)}?paypal=canceled`) };
}

/**
 * The link the student follows to approve the order in PayPal. A fresh
 * order carries it, and a reused one is read back, since Roomover keeps no
 * copy of PayPal's links.
 */
export async function approvalUrlFor(sdk: PayPalSdk, prepared: Pick<PreparedCheckout, "paypalOrderId" | "approvalUrl">): Promise<string | null> {
  if (prepared.approvalUrl !== null) return prepared.approvalUrl;
  return approvalLink(await retryTransient(() => getOrder(sdk, prepared.paypalOrderId))) ?? null;
}

const listingIdsOf = (layout: PlanLayout) => layout.items.flatMap((item) => (item.source === "listing" ? [item.listingId] : []));

/**
 * Prepares the one PayPal order a student approves for a plan. Code reads
 * every amount from the listings and the plan's agreed terms, so the order
 * holds exactly the plan's used items at their listed or agreed prices and
 * never a new item bought elsewhere. An order still awaiting approval with the
 * same lines is reused. Anything else gets a new order, with an idempotency
 * key derived from the new order's ID.
 */
export async function prepareCheckout(deps: CheckoutDeps, plan: CheckoutPlanRef): Promise<PreparedCheckout> {
  const { db, sdk, now } = deps;
  const ids = listingIdsOf(plan.layout);
  const current = await currentOrder(db, plan.id);
  // A released order gave its money back, so the room can be paid for again.
  if (current !== null && !REPAYABLE_STATUSES.has(current.status)) {
    throw new CheckoutRefused("paid", "This room is already paid for.");
  }
  const checkout = buildCheckout(ids, await loadCheckoutListings(db, ids, plan.id), now);
  if (
    current?.status === "pending_approval" &&
    current.paypalOrderId !== null &&
    current.paymentMode === checkout.paymentMode &&
    sameLines(current.lines, checkout.lines) &&
    now.getTime() - current.createdAt.getTime() < ORDER_REUSE_MS
  ) {
    return { order: current, paypalOrderId: current.paypalOrderId, approvalUrl: null, checkout, created: false };
  }

  const order = await insertPendingOrder(db, { planId: plan.id, buyerId: plan.buyerId, checkout });
  try {
    const key = orderCreateKey(order.id, order.attempt);
    const { returnUrl, cancelUrl } = checkoutReturnUrls(deps.appUrl, plan);
    const created = await retryTransient(() =>
      createOrder(
        sdk,
        {
          intent: intentFor(checkout.paymentMode),
          referenceId: order.id,
          items: checkout.lines.map((line) => ({ name: line.title, description: `From ${line.sellerName}`, unitAmountCents: line.amountCents, quantity: 1, sku: line.listingId })),
          returnUrl,
          cancelUrl,
        },
        key,
      ),
    );
    const paypalOrderId = createdOrderSchema.parse(created).id;
    await setPayPalOrderId(db, order.id, paypalOrderId);
    return { order: { ...order, paypalOrderId }, paypalOrderId, approvalUrl: approvalLink(created) ?? null, checkout, created: true };
  } catch (error) {
    await cancelPendingOrder(db, order.id);
    throw error;
  }
}
