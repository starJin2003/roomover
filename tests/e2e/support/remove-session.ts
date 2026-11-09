import { and, eq, inArray, like } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { listings, orderItems, orders, plans } from "@/lib/db/schema";
import { holdsMoney } from "@/lib/domain/order-state";
import { refundKey, voidKey } from "@/lib/paypal/idempotency";
import { paypalSdk } from "@/lib/paypal/server-sdk/client";
import { refundCapture, voidAuthorization } from "@/lib/paypal/server-sdk/payments";

export interface Removed {
  plans: number;
  orders: number;
  released: string[];
  listingsRestored: number;
}

/**
 * Deletes everything an e2e session created in the shared database, so a
 * run leaves it as it found it. Money PayPal still holds for those orders is
 * released first, and listings they reserved go back on sale. Plans cascade
 * to their runs and activity, orders to their items and checkout activity.
 * Webhook events stay, because PayPal sent them to the deployed route.
 */
export async function removeSessionData(session: { id: string } | { prefix: string }): Promise<Removed> {
  const db = getDb();
  const match = "id" in session ? eq(plans.sessionId, session.id) : like(plans.sessionId, `${session.prefix}%`);
  const planIds = (await db.select({ id: plans.id }).from(plans).where(match)).map((row) => row.id);
  if (planIds.length === 0) return { plans: 0, orders: 0, released: [], listingsRestored: 0 };

  const held = await db.select().from(orders).where(inArray(orders.planId, planIds));
  const released: string[] = [];
  for (const order of held.filter((candidate) => holdsMoney(candidate.status))) {
    if (order.paypalAuthorizationId !== null) {
      await voidAuthorization(paypalSdk(), order.paypalAuthorizationId, voidKey(order.id, order.attempt));
      released.push(order.paypalAuthorizationId);
    } else if (order.paypalCaptureId !== null) {
      await refundCapture(paypalSdk(), order.paypalCaptureId, {}, refundKey(order.id, order.attempt));
      released.push(order.paypalCaptureId);
    }
  }

  return db.transaction(async (tx) => {
    const orderIds = held.map((order) => order.id);
    const heldIds = held.filter((order) => holdsMoney(order.status)).map((order) => order.id);
    let listingsRestored = 0;
    if (heldIds.length > 0) {
      const reserved = (await tx.select({ id: orderItems.listingId }).from(orderItems).where(inArray(orderItems.orderId, heldIds))).map((row) => row.id);
      // Orders first, then listings, the lock order the daily reseed uses.
      await tx.delete(orders).where(inArray(orders.id, orderIds));
      const restored = await tx
        .update(listings)
        .set({ status: "active" })
        .where(and(inArray(listings.id, reserved), eq(listings.status, "reserved")))
        .returning({ id: listings.id });
      listingsRestored = restored.length;
    } else if (orderIds.length > 0) {
      await tx.delete(orders).where(inArray(orders.id, orderIds));
    }
    await tx.delete(plans).where(inArray(plans.id, planIds));
    return { plans: planIds.length, orders: orderIds.length, released, listingsRestored };
  });
}
