import { PayPalApiError, PayPalResponseError } from "@/lib/paypal/errors";

/** A 5xx, a 429, or a call that never got an answer. PayPal replays the first answer when the same PayPal-Request-Id comes back. */
export function isTransient(error: unknown): boolean {
  if (error instanceof PayPalApiError) return error.status >= 500 || error.status === 429;
  return !(error instanceof PayPalResponseError);
}

/** Runs a PayPal write once more after a transient failure. The caller passes the same idempotency key both times. */
export async function retryTransient<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isTransient(error)) throw error;
    return run();
  }
}

/**
 * PayPal answered and refused: a 4xx other than a timeout (408), a conflict
 * (409), or a rate limit (429). Nothing moved, and sending the same key again
 * only replays the refusal, so the next try takes the record's next attempt.
 * Timeouts, 5xx answers, 409 conflicts, and bodies Roomover cannot read leave
 * the outcome unknown, and those keep the key.
 */
export function isDefinite(error: unknown): boolean {
  return error instanceof PayPalApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 409 && error.status !== 429;
}

/**
 * Runs a keyed PayPal write with one retry after a transient failure. After
 * a definite refusal it moves the record to its next attempt before the
 * error goes on, so the student's Try again sends a fresh key.
 */
export async function keyedWrite<T>(run: () => Promise<T>, nextAttempt: () => Promise<void>): Promise<T> {
  try {
    return await retryTransient(run);
  } catch (error) {
    if (isDefinite(error)) await nextAttempt();
    throw error;
  }
}

/** The first issue name PayPal gave, such as INSTRUMENT_DECLINED. */
export const issueOf = (error: PayPalApiError): string | undefined => error.details[0]?.issue;
