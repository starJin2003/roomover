/**
 * PayPal-Request-Id values derived from Roomover record IDs.
 *
 * A key is a pure function of the action, the record, and the attempt number
 * stored on that record. Retrying after a timeout, a 5xx, or any answer whose
 * outcome is unknown sends the same key, so PayPal replays its first answer
 * and money moves at most once. A definite refusal (a 4xx such as a declined
 * capture) moves the record to its next attempt (`keyedWrite` in retry.ts),
 * so the next try gets a new key and PayPal judges it afresh.
 */

export type IdempotentAction =
  | "order-create"
  | "order-authorize"
  | "order-capture"
  | "capture"
  | "void"
  | "reauthorize"
  | "refund"
  | "payout";

const KEY_PREFIX = "rmv";
const MAX_KEY_LENGTH = 108;
const RECORD_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function idempotencyKey(action: IdempotentAction, recordId: string, attempt: number): string {
  if (!RECORD_ID.test(recordId)) {
    throw new RangeError(
      `Record ID for ${action} must be 1 to 64 letters, digits, hyphens, or underscores.`,
    );
  }
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new RangeError(`Attempt for ${action} must be a positive integer.`);
  }
  const key = `${KEY_PREFIX}.${action}.${recordId}.${attempt}`;
  if (key.length > MAX_KEY_LENGTH) {
    throw new RangeError(`Idempotency key for ${action} exceeds ${MAX_KEY_LENGTH} characters.`);
  }
  return key;
}

export const orderCreateKey = (checkoutId: string, attempt: number) =>
  idempotencyKey("order-create", checkoutId, attempt);

export const orderAuthorizeKey = (orderId: string, attempt: number) =>
  idempotencyKey("order-authorize", orderId, attempt);

export const orderCaptureKey = (orderId: string, attempt: number) =>
  idempotencyKey("order-capture", orderId, attempt);

export const captureKey = (orderItemId: string, attempt: number) =>
  idempotencyKey("capture", orderItemId, attempt);

export const voidKey = (orderId: string, attempt: number) => idempotencyKey("void", orderId, attempt);

export const reauthorizeKey = (orderId: string, attempt: number) =>
  idempotencyKey("reauthorize", orderId, attempt);

export const refundKey = (orderItemId: string, attempt: number) =>
  idempotencyKey("refund", orderItemId, attempt);

export const payoutKey = (settlementId: string, attempt: number) =>
  idempotencyKey("payout", settlementId, attempt);
