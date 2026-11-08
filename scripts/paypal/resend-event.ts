/**
 * Replays a stored webhook event through PayPal and proves the deployed route
 * skips it. PayPal redelivers the event with its original ID and a fresh
 * signature to the configured webhook. After the wait, webhook_events must
 * still hold one unchanged row for the event and no row received after the
 * resend.
 *
 *   pnpm paypal:resend <event-id>
 */
import { setTimeout as sleep } from "node:timers/promises";
import { eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { readConfig } from "@/lib/config";
import { createDatabase, createPool, type Database } from "@/lib/db/client";
import { webhookEvents } from "@/lib/db/schema";
import { readPayPalWebhookId } from "@/lib/paypal/config";
import { paypalRest } from "@/lib/paypal/rest/client";
import { resendWebhookEvent } from "@/lib/paypal/rest/webhooks";
import { reportScriptError } from "./report-error";

const DELIVERY_WAIT_MS = 45_000;

const argsSchema = z.tuple([z.string().min(1, "Pass the webhook event ID to resend.")]);
const clockSchema = z.object({ now: z.coerce.date() });

async function storedRows(db: Database, eventId: string) {
  return db
    .select({ eventType: webhookEvents.eventType, processedAt: webhookEvents.processedAt })
    .from(webhookEvents)
    .where(eq(webhookEvents.paypalEventId, eventId));
}

const describeRows = (rows: Awaited<ReturnType<typeof storedRows>>) =>
  rows.length === 0
    ? "no row"
    : rows.map((row) => `${row.eventType}, processed ${row.processedAt?.toISOString() ?? "never"}`).join("; ");

async function main(): Promise<void> {
  const [eventId] = argsSchema.parse(process.argv.slice(2));
  const webhookId = readPayPalWebhookId();
  if (webhookId === undefined) throw new Error("PAYPAL_WEBHOOK_ID is not set in .env.local.");

  const pool = createPool(readConfig(["DATABASE_URL"]).DATABASE_URL, 1);
  try {
    const db = createDatabase(pool);
    const before = await storedRows(db, eventId);
    console.log(`Before: ${before.length} row for ${eventId} (${describeRows(before)})`);

    // The database clock marks the resend, so local clock skew cannot hide a new row.
    // Drizzle hands raw timestamptz values back as strings.
    const clock = await db.execute(sql`select now() as now`);
    const { now: startedAt } = clockSchema.parse(clock.rows[0]);
    const resent = await resendWebhookEvent(paypalRest(), eventId, [webhookId]);
    console.log(`PayPal accepted the resend of ${resent.event_type} ${resent.id} to the webhook ending ${webhookId.slice(-4)}`);

    console.log(`Waiting ${DELIVERY_WAIT_MS / 1000} s for the delivery`);
    await sleep(DELIVERY_WAIT_MS);

    const after = await storedRows(db, eventId);
    const arrived = await db
      .select({ paypalEventId: webhookEvents.paypalEventId, eventType: webhookEvents.eventType })
      .from(webhookEvents)
      .where(gte(webhookEvents.receivedAt, startedAt));
    console.log(`After: ${after.length} row for ${eventId} (${describeRows(after)})`);
    console.log(`Rows received since the resend: ${arrived.length}`);
    for (const row of arrived) console.log(`  ${row.eventType} ${row.paypalEventId}`);

    if (describeRows(after) !== describeRows(before) || arrived.length > 0) {
      throw new Error("The resend changed webhook_events. Deduplication did not hold.");
    }
    // A skipped duplicate writes nothing, so only the service log shows that the delivery landed.
    console.log(`Confirm the delivery in the service log: "paypal webhook duplicate skipped" for eventId ${eventId}`);
  } finally {
    await pool.end();
  }
}

main().catch(reportScriptError);
