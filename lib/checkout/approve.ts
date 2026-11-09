import { z } from "zod";
import { cancelPendingOrder, ListingTaken, loadCheckoutListings, orderByPayPalId, recordApproval, type ApprovalRecord, type ApprovalResult, type OrderWithLines } from "@/lib/db/orders";
import { holdsMoney } from "@/lib/domain/order-state";
import { PayPalApiError } from "@/lib/paypal/errors";
import { orderAuthorizeKey, orderCaptureKey, refundKey, voidKey } from "@/lib/paypal/idempotency";
import { issueOf, retryTransient } from "@/lib/paypal/retry";
import { refundCapture, voidAuthorization } from "@/lib/paypal/server-sdk/payments";
import { authorizeOrder, captureOrder, getOrder } from "@/lib/paypal/server-sdk/orders";
import type { CheckoutDeps } from "./prepare";

export type CheckoutFailure = "not_found" | "declined" | "expired" | "not_approved" | "taken" | "failed";

/** A checkout that did not go through, with one sentence that says what to do next. */
export class CheckoutFailed extends Error {
  constructor(
    readonly code: CheckoutFailure,
    message: string,
  ) {
    super(message);
    this.name = "CheckoutFailed";
  }
}

const SENTENCES: Readonly<Record<CheckoutFailure, string>> = {
  not_found: "Roomover has no order with that ID for this room. Reload the page and press PayPal again.",
  declined: "PayPal declined that payment method, so nothing was charged. Press PayPal again and choose another card or your PayPal balance.",
  expired: "That checkout expired before it was paid. Press PayPal again to start a fresh one.",
  not_approved: "PayPal has not finished the approval yet. Press PayPal again and approve the payment there.",
  taken: "Another student just bought an item in this room, so nothing was charged. Plan the room again to replace it.",
  failed: "PayPal did not complete the payment. Nothing was charged. Try again in a moment.",
};

export const failure = (code: CheckoutFailure) => new CheckoutFailed(code, SENTENCES[code]);

/** The parts of an Orders v2 answer that say how the payment landed. */
const paymentsSchema = z.object({
  id: z.string().min(1),
  purchaseUnits: z
    .array(
      z.object({
        payments: z
          .object({
            authorizations: z.array(z.object({ id: z.string().min(1), status: z.string().optional(), expirationTime: z.string().optional() })).optional(),
            captures: z.array(z.object({ id: z.string().min(1), status: z.string().optional() })).optional(),
          })
          .optional(),
      }),
    )
    .min(1),
});

const DECLINED_ISSUES = new Set(["INSTRUMENT_DECLINED", "REDIRECT_PAYER_FOR_ALTERNATE_FUNDING", "TRANSACTION_REFUSED"]);
const EXPIRED_ISSUES = new Set(["ORDER_EXPIRED", "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "ORDER_COMPLETED_OR_VOIDED"]);
const NOT_APPROVED_ISSUES = new Set(["ORDER_NOT_APPROVED", "PAYER_ACTION_REQUIRED"]);
const ALREADY_ISSUES = new Set(["ORDER_ALREADY_AUTHORIZED", "ORDER_ALREADY_CAPTURED"]);

/** Reads an authorize or capture answer, or a fetched order, into the result checkout records. */
export function recordFromOrder(answer: unknown, at: Date): ApprovalRecord {
  const order = paymentsSchema.parse(answer);
  const payments = order.purchaseUnits[0].payments;
  const authorization = payments?.authorizations?.[0];
  if (authorization !== undefined) {
    if (authorization.status === "DENIED" || authorization.status === "VOIDED") throw failure("declined");
    const expires = authorization.expirationTime === undefined ? undefined : new Date(authorization.expirationTime);
    return { paypalOrderId: order.id, status: "authorized", authorizationId: authorization.id, authorizationExpiresAt: expires, source: "api", at };
  }
  const capture = payments?.captures?.[0];
  if (capture !== undefined) {
    const status = capture.status === "COMPLETED" ? "captured" : capture.status === "PENDING" ? "capture_pending" : "capture_declined";
    return { paypalOrderId: order.id, status, captureId: capture.id, source: "api", at };
  }
  throw failure("not_approved");
}

/** Gives the money back when an item sold elsewhere between approval and recording. */
async function release(deps: CheckoutDeps, order: OrderWithLines, record: ApprovalRecord): Promise<void> {
  try {
    if (record.authorizationId !== undefined) await retryTransient(() => voidAuthorization(deps.sdk, record.authorizationId as string, voidKey(order.id, order.attempt)));
    else if (record.captureId !== undefined) await retryTransient(() => refundCapture(deps.sdk, record.captureId as string, {}, refundKey(order.id, order.attempt)));
  } catch (error) {
    console.error("checkout release failed", { orderId: order.id, error: error instanceof PayPalApiError ? error.debugId : "unknown" });
  }
  await cancelPendingOrder(deps.db, order.id);
}

/**
 * Finishes a checkout after the student approves in PayPal. Authorize mode
 * authorizes the order and capture mode captures it, each with a key derived
 * from the order, so a retried request moves money once. A webhook may land
 * the same result first, and then this call returns what it recorded.
 */
export async function approveCheckout(deps: CheckoutDeps, input: { planId: string; paypalOrderId: string }): Promise<ApprovalResult> {
  const { db, sdk, now } = deps;
  const order = await orderByPayPalId(db, input.paypalOrderId);
  if (order === null || order.planId !== input.planId) throw failure("not_found");
  if (holdsMoney(order.status)) return { order, step: "duplicate", events: [] };
  if (order.status === "canceled") throw failure("expired");

  const listings = await loadCheckoutListings(db, order.lines.map((line) => line.listingId));
  if (order.lines.some((line) => listings.get(line.listingId)?.status !== "active")) {
    await cancelPendingOrder(db, order.id);
    throw failure("taken");
  }

  let record: ApprovalRecord;
  try {
    const answer =
      order.paymentMode === "authorize_then_capture"
        ? await retryTransient(() => authorizeOrder(sdk, input.paypalOrderId, orderAuthorizeKey(order.id, order.attempt)))
        : await retryTransient(() => captureOrder(sdk, input.paypalOrderId, orderCaptureKey(order.id, order.attempt)));
    record = recordFromOrder(answer, now);
  } catch (error) {
    if (error instanceof CheckoutFailed) {
      if (error.code === "declined") await cancelPendingOrder(db, order.id);
      throw error;
    }
    if (!(error instanceof PayPalApiError)) throw error;
    const issue = issueOf(error) ?? "";
    if (ALREADY_ISSUES.has(issue)) {
      record = recordFromOrder(await getOrder(sdk, input.paypalOrderId), now);
    } else if (DECLINED_ISSUES.has(issue)) {
      await cancelPendingOrder(db, order.id);
      throw failure("declined");
    } else if (EXPIRED_ISSUES.has(issue) || error.status === 404) {
      await cancelPendingOrder(db, order.id);
      throw failure("expired");
    } else if (NOT_APPROVED_ISSUES.has(issue)) {
      throw failure("not_approved");
    } else {
      console.error("checkout approval failed", { orderId: order.id, status: error.status, issue, debugId: error.debugId });
      throw failure("failed");
    }
  }

  try {
    const result = await recordApproval(db, record);
    if (result === null) throw failure("not_found");
    return result;
  } catch (error) {
    if (!(error instanceof ListingTaken)) throw error;
    await release(deps, order, record);
    throw failure("taken");
  }
}
