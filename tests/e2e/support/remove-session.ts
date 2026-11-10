import { and, eq, inArray, like, notExists, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { disputes, listingDrafts, listingPhotos, listings, orderItems, orders, payouts, plans, sellerAgentCalls } from "@/lib/db/schema";
import { holdsMoney, MONEY_HELD_STATUSES } from "@/lib/domain/order-state";
import { refundKey, voidKey } from "@/lib/paypal/idempotency";
import { paypalSdk } from "@/lib/paypal/server-sdk/client";
import { refundCapture, voidAuthorization } from "@/lib/paypal/server-sdk/payments";

export interface Removed {
  plans: number;
  orders: number;
  released: string[];
  listingsRestored: number;
  /** Listings the session made on Sell, with their drafts and photos. */
  sellListings: number;
}

/**
 * Deletes everything an e2e session created in the shared database, so a
 * run leaves it as it found it. Money PayPal still holds for those orders is
 * released first, and listings they reserved or sold go back on sale.
 * Payouts and disputes are deleted before their orders, and plans cascade to their runs
 * and activity, orders to their items, handoffs, and photos. Webhook events
 * stay, because PayPal sent them to the deployed route. Sandbox payouts
 * that already reached the sellers stay paid.
 */
export async function removeSessionData(session: { id: string } | { prefix: string }): Promise<Removed> {
  const db = getDb();
  const sellListings = await removeSellData(session);
  const match = "id" in session ? eq(plans.sessionId, session.id) : like(plans.sessionId, `${session.prefix}%`);
  const planIds = (await db.select({ id: plans.id }).from(plans).where(match)).map((row) => row.id);
  if (planIds.length === 0) return { plans: 0, orders: 0, released: [], listingsRestored: 0, sellListings };

  const held = await db.select().from(orders).where(inArray(orders.planId, planIds));
  const released: string[] = [];
  for (const order of held.filter((candidate) => holdsMoney(candidate.status))) {
    const authorization = order.paypalReauthorizationId ?? order.paypalAuthorizationId;
    if (authorization !== null && order.voidedAt === null) {
      // A settlement that stopped partway may have closed the authorization already, which is fine here.
      await voidAuthorization(paypalSdk(), authorization, voidKey(order.id, order.attempt)).catch(() => undefined);
      released.push(authorization);
    } else if (order.paypalCaptureId !== null) {
      await refundCapture(paypalSdk(), order.paypalCaptureId, {}, refundKey(order.id, order.attempt)).catch(() => undefined);
      released.push(order.paypalCaptureId);
    }
  }

  return db.transaction(async (tx) => {
    const orderIds = held.map((order) => order.id);
    let listingsRestored = 0;
    if (orderIds.length > 0) {
      const taken = (await tx.select({ id: orderItems.listingId }).from(orderItems).where(inArray(orderItems.orderId, orderIds))).map((row) => row.id);
      await tx.update(orderItems).set({ payoutItemId: null }).where(inArray(orderItems.orderId, orderIds));
      await tx.delete(payouts).where(inArray(payouts.orderId, orderIds));
      await tx.delete(disputes).where(inArray(disputes.orderId, orderIds));
      // Orders first, then listings, the lock order the daily reseed uses.
      await tx.delete(orders).where(inArray(orders.id, orderIds));
      if (taken.length > 0) {
        // A listing that another order still holds money for stays as that order left it. Sold listings of settled orders return through the reseed.
        const heldElsewhere = tx
          .select({ one: sql`1` })
          .from(orderItems)
          .innerJoin(orders, eq(orderItems.orderId, orders.id))
          .where(and(eq(orderItems.listingId, listings.id), inArray(orders.status, [...MONEY_HELD_STATUSES])));
        const restored = await tx
          .update(listings)
          .set({ status: "active" })
          .where(and(inArray(listings.id, taken), inArray(listings.status, ["reserved", "sold"]), notExists(heldElsewhere)))
          .returning({ id: listings.id });
        listingsRestored = restored.length;
      }
    }
    await tx.delete(plans).where(inArray(plans.id, planIds));
    return { plans: planIds.length, orders: orderIds.length, released, listingsRestored, sellListings };
  });
}

/** Deletes what the session made on Sell. Drafts go first, since they name the listings and the photos. */
async function removeSellData(session: { id: string } | { prefix: string }): Promise<number> {
  const bySession = <T extends typeof listingDrafts.sessionId | typeof listings.sessionId | typeof listingPhotos.sessionId | typeof sellerAgentCalls.sessionId>(column: T) =>
    "id" in session ? eq(column, session.id) : like(column, `${session.prefix}%`);
  return getDb().transaction(async (tx) => {
    await tx.delete(sellerAgentCalls).where(bySession(sellerAgentCalls.sessionId));
    await tx.delete(listingDrafts).where(bySession(listingDrafts.sessionId));
    const removed = await tx.delete(listings).where(bySession(listings.sessionId)).returning({ id: listings.id });
    await tx.delete(listingPhotos).where(bySession(listingPhotos.sessionId));
    return removed.length;
  });
}
