/**
 * End to end webhook proof. Sends a 1.00 USD sandbox payout from the platform
 * to the judge buyer, so seller balances stay at zero, then waits for the
 * signed payout events to land in webhook_events through the deployed route.
 * The idempotency key is fixed, so a rerun replays the same batch and only
 * checks the events again.
 *
 *   pnpm paypal:payout-proof
 */
import { setTimeout as sleep } from "node:timers/promises";
import { asc, inArray } from "drizzle-orm";
import { readConfig } from "@/lib/config";
import { createDatabase, createPool } from "@/lib/db/client";
import { webhookEvents } from "@/lib/db/schema";
import { payoutKey } from "@/lib/paypal/idempotency";
import { paypalRest } from "@/lib/paypal/rest/client";
import { createPayoutBatch, getPayoutBatch } from "@/lib/paypal/rest/payouts";
import { SANDBOX_EMAILS } from "../seed/people";
import { reportScriptError } from "./report-error";

const PROOF_ID = "webhook-proof";
const SETTLED_BATCH = new Set(["SUCCESS", "DENIED", "CANCELED"]);
const BATCH_EVENTS = new Set(["PAYMENT.PAYOUTSBATCH.SUCCESS", "PAYMENT.PAYOUTSBATCH.DENIED"]);

async function main(): Promise<void> {
  const rest = paypalRest();
  const key = payoutKey(PROOF_ID, 1);
  const created = await createPayoutBatch(
    rest,
    {
      emailSubject: "Roomover webhook check",
      emailMessage: "A 1.00 USD sandbox payout that confirms Roomover receives PayPal webhooks.",
      items: [
        {
          senderItemId: `${PROOF_ID}-1`,
          amountCents: 100,
          recipientType: "EMAIL",
          receiver: SANDBOX_EMAILS.judgeBuyer,
          wallet: "PAYPAL",
        },
      ],
    },
    key,
  );
  const batchId = created.batch_header.payout_batch_id;
  console.log(`PayPal-Request-Id ${key}`);
  console.log(`Payout batch ${batchId} (${created.batch_header.batch_status})`);

  let batch = await getPayoutBatch(rest, batchId);
  for (let attempt = 0; attempt < 24 && !SETTLED_BATCH.has(batch.batch_header.batch_status); attempt++) {
    await sleep(5_000);
    batch = await getPayoutBatch(rest, batchId);
  }
  console.log(`Batch status ${batch.batch_header.batch_status}`);
  for (const item of batch.items) {
    console.log(`Payout item ${item.payout_item_id} (${item.transaction_status ?? "no status"})`);
  }

  const resourceIds = [batchId, ...batch.items.map((item) => item.payout_item_id)];
  const pool = createPool(readConfig(["DATABASE_URL"]).DATABASE_URL, 1);
  try {
    const db = createDatabase(pool);
    const stored = async () =>
      db
        .select()
        .from(webhookEvents)
        .where(inArray(webhookEvents.resourceId, resourceIds))
        .orderBy(asc(webhookEvents.receivedAt));

    let rows = await stored();
    for (let attempt = 0; attempt < 30 && !rows.some((row) => BATCH_EVENTS.has(row.eventType)); attempt++) {
      await sleep(10_000);
      rows = await stored();
    }
    for (const row of rows) {
      const processed = row.processedAt?.toISOString() ?? "not processed";
      console.log(`Stored ${row.eventType} ${row.paypalEventId} for ${row.resourceId}, processed ${processed}`);
    }
    if (!rows.some((row) => BATCH_EVENTS.has(row.eventType))) {
      throw new Error(`No payout batch event for ${batchId} reached webhook_events within 5 minutes.`);
    }
  } finally {
    await pool.end();
  }
}

main().catch(reportScriptError);
