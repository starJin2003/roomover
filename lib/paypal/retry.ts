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

/** The first issue name PayPal gave, such as INSTRUMENT_DECLINED. */
export const issueOf = (error: PayPalApiError): string | undefined => error.details[0]?.issue;
