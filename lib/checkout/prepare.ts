import { z } from "zod";
import type { Database } from "@/lib/db/client";
import { cancelPendingOrder, currentOrder, insertPendingOrder, loadCheckoutListings, setPayPalOrderId, type OrderWithLines } from "@/lib/db/orders";
import { buildCheckout, CheckoutRefused, intentFor, sameLines, type CheckoutPlan } from "@/lib/domain/checkout";
import type { OrderStatus } from "@/lib/domain/enums";
import type { PlanLayout } from "@/lib/domain/layout";
import { orderCreateKey } from "@/lib/paypal/idempotency";
import { retryTransient } from "@/lib/paypal/retry";
import type { PayPalSdk } from "@/lib/paypal/server-sdk/client";
import { createOrder } from "@/lib/paypal/server-sdk/orders";

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
  checkout: CheckoutPlan;
  /** False when the plan's existing order still fits and was handed back. */
  created: boolean;
}

export interface CheckoutPlanRef {
  id: string;
  buyerId: string;
  layout: PlanLayout;
}

const listingIdsOf = (layout: PlanLayout) => layout.items.flatMap((item) => (item.source === "listing" ? [item.listingId] : []));

/**
 * Prepares the one PayPal order a student approves for a plan. Code reads
 * every amount from the listings, so the order holds exactly the plan's
 * items at their listed prices. An order still awaiting approval with the
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
  const checkout = buildCheckout(ids, await loadCheckoutListings(db, ids), now);
  if (
    current?.status === "pending_approval" &&
    current.paypalOrderId !== null &&
    current.paymentMode === checkout.paymentMode &&
    sameLines(current.lines, checkout.lines) &&
    now.getTime() - current.createdAt.getTime() < ORDER_REUSE_MS
  ) {
    return { order: current, paypalOrderId: current.paypalOrderId, checkout, created: false };
  }

  const order = await insertPendingOrder(db, { planId: plan.id, buyerId: plan.buyerId, checkout });
  try {
    const key = orderCreateKey(order.id, order.attempt);
    const returnUrl = `${deps.appUrl}/furnish`;
    const created = await retryTransient(() =>
      createOrder(
        sdk,
        {
          intent: intentFor(checkout.paymentMode),
          referenceId: order.id,
          items: checkout.lines.map((line) => ({ name: line.title, description: `From ${line.sellerName}`, unitAmountCents: line.amountCents, quantity: 1, sku: line.listingId })),
          returnUrl,
          cancelUrl: returnUrl,
        },
        key,
      ),
    );
    const paypalOrderId = createdOrderSchema.parse(created).id;
    await setPayPalOrderId(db, order.id, paypalOrderId);
    return { order: { ...order, paypalOrderId }, paypalOrderId, checkout, created: true };
  } catch (error) {
    await cancelPendingOrder(db, order.id);
    throw error;
  }
}
