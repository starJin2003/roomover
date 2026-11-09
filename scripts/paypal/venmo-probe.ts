import { paypalRest } from "@/lib/paypal/rest/client";
import { PayPalApiError } from "@/lib/paypal/errors";
import { createPayoutBatch, getPayoutBatch } from "@/lib/paypal/rest/payouts";

/**
 * Tries one $1.00 Venmo payout in the sandbox, to a seller's Venmo handle
 * (USER_HANDLE), and reports whether PayPal took the batch and what the
 * item became. The key is fixed, so a second run reads the same batch back
 * and pays nothing more.
 *
 *   pnpm paypal:venmo-probe
 */

const KEY = "rmv.payout.venmo-probe.1";
const HANDLE = "roomover-seller1-jin0608";

async function main() {
  const rest = paypalRest();
  try {
    const created = await createPayoutBatch(
      rest,
      {
        emailSubject: "Roomover Venmo payout test",
        items: [{ senderItemId: "venmo-probe-1", amountCents: 100, recipientType: "USER_HANDLE", receiver: HANDLE, wallet: "VENMO", note: "Roomover sandbox test of a Venmo payout." }],
      },
      KEY,
    );
    const batchId = created.batch_header.payout_batch_id;
    console.log(JSON.stringify({ accepted: true, batchId, batchStatus: created.batch_header.batch_status }));
    await new Promise((resolve) => setTimeout(resolve, 25_000));
    const batch = await getPayoutBatch(rest, batchId);
    console.log(JSON.stringify({ batchStatus: batch.batch_header.batch_status, items: batch.items.map((item) => ({ payoutItemId: item.payout_item_id, status: item.transaction_status, wallet: item.payout_item.recipient_wallet, error: item.errors?.name })) }));
  } catch (error) {
    if (!(error instanceof PayPalApiError)) throw error;
    console.log(JSON.stringify({ accepted: false, status: error.status, name: error.errorName, issue: error.details[0]?.issue, debugId: error.debugId }));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "unknown");
  process.exitCode = 1;
});
