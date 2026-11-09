import { publish } from "@/lib/agents/bus";
import type { Database } from "@/lib/db/client";
import { applyPayoutBatchStatus, applyPayoutItemStatus, insertHandoffEvents, insertPayout, loadHandoffOrderById, recordPayoutBatch, sellerReceivers, type HandoffOrder, type PayoutChange } from "@/lib/db/handoffs";
import { batchStatusFromPayPal, itemStatusFromPayPal } from "@/lib/domain/payout-state";
import { payoutLines } from "@/lib/domain/settlement";
import { formatUsdShort } from "@/lib/format";
import { payoutKey } from "@/lib/paypal/idempotency";
import type { PayPalRestClient } from "@/lib/paypal/rest/client";
import { createPayoutBatch, getPayoutBatch } from "@/lib/paypal/rest/payouts";
import { retryTransient } from "@/lib/paypal/retry";

export interface PayoutDeps {
  db: Database;
  rest: PayPalRestClient;
  now: () => Date;
}

const EMAIL_SUBJECT = "You got paid for your Roomover sale";
const EMAIL_MESSAGE = "The student who bought from you checked the item at handoff, and Roomover sent your share through PayPal.";

/**
 * Pays every seller who kept money in one Payouts batch. The order's
 * payout key is both the PayPal-Request-Id and the sender_batch_id, so a
 * retry after a lost answer gets PayPal's first answer back and pays nobody
 * twice.
 */
export async function sendPayout(deps: PayoutDeps, order: HandoffOrder, roomLabel: string): Promise<void> {
  const lines = payoutLines(order.items.map((item) => ({ orderItemId: item.orderItemId, sellerId: item.sellerId, payCents: item.handoff?.payCents ?? 0 })));
  if (lines.length === 0) return;

  if (order.payout === null) {
    const receivers = await sellerReceivers(deps.db, lines.map((line) => line.sellerId));
    await insertPayout(deps.db, {
      orderId: order.id,
      senderBatchId: payoutKey(order.id, order.attempt),
      lines: lines.map((line) => {
        const receiver = receivers.get(line.sellerId);
        if (receiver === undefined) throw new Error(`Seller ${line.sellerId} has no payout receiver.`);
        if (receiver.payoutWallet === "venmo" && receiver.venmoHandle !== null) return { ...line, wallet: "venmo" as const, receiver: receiver.venmoHandle };
        if (receiver.paypalEmail === null) throw new Error(`Seller ${line.sellerId} has no PayPal email for payouts.`);
        return { ...line, wallet: "paypal" as const, receiver: receiver.paypalEmail };
      }),
    });
  }
  const current = await loadHandoffOrderById(deps.db, order.id);
  const payout = current?.payout;
  if (current === null || payout === null || payout === undefined || payout.paypalBatchId !== null) return;

  const titles = new Map<string, string[]>();
  for (const item of current.items) if ((item.handoff?.payCents ?? 0) > 0) titles.set(item.sellerId, [...(titles.get(item.sellerId) ?? []), item.title]);
  const created = await retryTransient(() =>
    createPayoutBatch(
      deps.rest,
      {
        emailSubject: EMAIL_SUBJECT,
        emailMessage: EMAIL_MESSAGE,
        items: payout.items.map((item) => ({
          senderItemId: item.senderItemId,
          amountCents: item.amountCents,
          recipientType: item.wallet === "venmo" ? "USER_HANDLE" : "EMAIL",
          receiver: item.receiver,
          wallet: item.wallet === "venmo" ? "VENMO" : "PAYPAL",
          note: `Roomover payment for ${(titles.get(item.sellerId) ?? ["your item"]).join(", ")}, handed off in ${roomLabel}.`,
        })),
      },
      payout.senderBatchId,
    ),
  );
  const batchId = created.batch_header.payout_batch_id;
  await recordPayoutBatch(deps.db, payout.id, batchId);
  await applyPayoutBatchStatus(deps.db, { paypalBatchId: batchId, senderBatchId: payout.senderBatchId }, batchStatusFromPayPal(created.batch_header.batch_status));
  const sellers = payout.items.length;
  await insertHandoffEvents(deps.db, current, "platform", [
    {
      tool: "send_payouts",
      sentence: `PayPal is paying ${sellers === 1 ? "1 seller" : `${sellers} sellers`} ${formatUsdShort(payout.totalCents)} in one payout.`,
      summary: `Created payout batch ${batchId} for ${formatUsdShort(payout.totalCents)} to ${sellers} sellers with sender_batch_id ${payout.senderBatchId}.`,
      detail: { totalCents: payout.totalCents, paypalIdKind: "payout_batch" },
      paypal: { api: "Payouts", id: batchId },
    },
  ]);
}

/** Notes the moment every seller is paid, once, whichever path delivered the last status. */
export async function notePayoutChanges(db: Database, orderId: string, changes: readonly PayoutChange[]): Promise<void> {
  if (!changes.some((change) => change?.step === "apply")) return;
  const order = await loadHandoffOrderById(db, orderId);
  const payout = order?.payout;
  if (order === null || payout === null || payout === undefined || payout.paypalBatchId === null) return;
  if (!payout.items.every((item) => item.status === "succeeded")) return;
  const [first] = changes.filter((change) => change?.step === "apply");
  if (first === null || first === undefined) return;
  await insertHandoffEvents(db, order, "platform", [
    {
      tool: "payouts_landed",
      sentence: `Every seller got their share. ${formatUsdShort(payout.totalCents)} reached ${payout.items.length === 1 ? "1 PayPal account" : `${payout.items.length} PayPal accounts`}.`,
      summary: `All ${payout.items.length} payout items of batch ${payout.paypalBatchId} reached SUCCESS.`,
      detail: { totalCents: payout.totalCents, paypalIdKind: "payout_batch" },
      paypal: { api: "Payouts", id: payout.paypalBatchId },
    },
  ]);
}

const REFRESH_MS = 2_000;
const store = globalThis as typeof globalThis & { roomoverPayoutRefresh?: Map<string, number> };

/**
 * Reads the batch back from PayPal and lands each item's status through the
 * same transitions as the webhooks. Webhooks reach only the deployed app,
 * so this keeps a local server, and a webhook that is late, in step. Calls
 * within 2 seconds of the last one for the same order do nothing.
 */
export async function refreshPayout(deps: PayoutDeps, orderId: string): Promise<void> {
  const last = (store.roomoverPayoutRefresh ??= new Map());
  const now = Date.now();
  if (now - (last.get(orderId) ?? 0) < REFRESH_MS) return;
  last.set(orderId, now);

  const order = await loadHandoffOrderById(deps.db, orderId);
  const payout = order?.payout;
  if (order === null || payout === null || payout === undefined || payout.paypalBatchId === null) return;
  const batch = await getPayoutBatch(deps.rest, payout.paypalBatchId);
  const at = deps.now();
  const changes: PayoutChange[] = [await applyPayoutBatchStatus(deps.db, { paypalBatchId: payout.paypalBatchId }, batchStatusFromPayPal(batch.batch_header.batch_status))];
  for (const item of batch.items) {
    const senderItemId = item.payout_item.sender_item_id;
    changes.push(await applyPayoutItemStatus(deps.db, { paypalPayoutItemId: item.payout_item_id, senderItemId }, itemStatusFromPayPal(item.transaction_status), at));
  }
  await notePayoutChanges(deps.db, orderId, changes);
  if (changes.some((change) => change?.step === "apply")) publish(order.planId, { type: "handoff" });
}
