import {
  PaymentsController,
  type CapturedPayment,
  type PaymentAuthorization,
  type Refund,
} from "@paypal/paypal-server-sdk";
import { callSdk, type PayPalSdk } from "@/lib/paypal/server-sdk/client";
import { sdkMoney } from "@/lib/paypal/wire-money";

const PREFER_FULL = "return=representation";

export interface CaptureInput {
  /** Omit to capture the full remaining authorized amount. */
  readonly amountCents?: number;
  /**
   * true closes the authorization after this capture and releases what is
   * left of the hold. false keeps it open for more captures, one per item.
   */
  readonly finalCapture: boolean;
  /** Unique per merchant account, so use one invoice ID per capture. */
  readonly invoiceId?: string;
  readonly noteToPayer?: string;
}

export function captureAuthorization(
  sdk: PayPalSdk,
  authorizationId: string,
  input: CaptureInput,
  idempotencyKey: string,
): Promise<CapturedPayment> {
  return callSdk(sdk, "POST /v2/payments/authorizations/{id}/capture", () =>
    new PaymentsController(sdk.client).captureAuthorizedPayment({
      authorizationId,
      paypalRequestId: idempotencyKey,
      prefer: PREFER_FULL,
      body: {
        amount: input.amountCents === undefined ? undefined : sdkMoney(input.amountCents),
        finalCapture: input.finalCapture,
        invoiceId: input.invoiceId,
        noteToPayer: input.noteToPayer,
      },
    }),
  );
}

/** Releases the remaining hold. PayPal answers 204 when the full representation is not returned. */
export function voidAuthorization(
  sdk: PayPalSdk,
  authorizationId: string,
  idempotencyKey: string,
): Promise<PaymentAuthorization | null> {
  return callSdk(sdk, "POST /v2/payments/authorizations/{id}/void", () =>
    new PaymentsController(sdk.client).voidPayment({
      authorizationId,
      paypalRequestId: idempotencyKey,
      prefer: PREFER_FULL,
    }),
  );
}

/**
 * Renews funds after the three day honor period and within the 29 day
 * authorization period. Omit the amount to reauthorize the original amount.
 */
export function reauthorizeAuthorization(
  sdk: PayPalSdk,
  authorizationId: string,
  input: { readonly amountCents?: number },
  idempotencyKey: string,
): Promise<PaymentAuthorization> {
  return callSdk(sdk, "POST /v2/payments/authorizations/{id}/reauthorize", () =>
    new PaymentsController(sdk.client).reauthorizePayment({
      authorizationId,
      paypalRequestId: idempotencyKey,
      prefer: PREFER_FULL,
      body: { amount: input.amountCents === undefined ? undefined : sdkMoney(input.amountCents) },
    }),
  );
}

export function refundCapture(
  sdk: PayPalSdk,
  captureId: string,
  input: { readonly amountCents?: number; readonly noteToPayer?: string; readonly invoiceId?: string },
  idempotencyKey: string,
): Promise<Refund> {
  return callSdk(sdk, "POST /v2/payments/captures/{id}/refund", () =>
    new PaymentsController(sdk.client).refundCapturedPayment({
      captureId,
      paypalRequestId: idempotencyKey,
      prefer: PREFER_FULL,
      body: {
        amount: input.amountCents === undefined ? undefined : sdkMoney(input.amountCents),
        noteToPayer: input.noteToPayer,
        invoiceId: input.invoiceId,
      },
    }),
  );
}
