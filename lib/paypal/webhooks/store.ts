import { eq, sql } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { webhookEvents } from "@/lib/db/schema";
import { webhookResourceId, type PayPalWebhookEvent } from "@/lib/paypal/webhooks/events";

export type WebhookOutcome = { readonly duplicate: true } | { readonly duplicate: false; readonly handled: boolean };

/**
 * Stores a verified event and runs its handler in one transaction. The unique
 * PayPal event ID makes a redelivery insert nothing, so it is acknowledged
 * and skipped. A concurrent redelivery waits on that unique index until the
 * first delivery commits. When the handler throws, the insert rolls back and
 * the next delivery runs it again.
 */
export function recordWebhookEvent(
  event: PayPalWebhookEvent,
  dispatch: (event: PayPalWebhookEvent) => Promise<boolean>,
  db: Database = getDb(),
): Promise<WebhookOutcome> {
  return db.transaction(async (tx) => {
    const [stored] = await tx
      .insert(webhookEvents)
      .values({
        paypalEventId: event.id,
        eventType: event.event_type,
        resourceType: event.resource_type ?? null,
        resourceId: webhookResourceId(event),
        eventCreatedAt: new Date(event.create_time),
      })
      .onConflictDoNothing({ target: webhookEvents.paypalEventId })
      .returning({ id: webhookEvents.id });
    if (stored === undefined) return { duplicate: true };

    const handled = await dispatch(event);
    await tx.update(webhookEvents).set({ processedAt: sql`now()` }).where(eq(webhookEvents.id, stored.id));
    return { duplicate: false, handled };
  });
}
