import { readPayPalWebhookId } from "@/lib/paypal/config";
import { PayPalApiError } from "@/lib/paypal/errors";
import { paypalRest } from "@/lib/paypal/rest/client";
import { readWebhookTransmission, verifyWebhookSignature } from "@/lib/paypal/rest/webhooks";
import { dispatchWebhookEvent } from "@/lib/paypal/webhooks/dispatch";
import { webhookEventSchema } from "@/lib/paypal/webhooks/events";

function reply(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

function configuredWebhookId(): string | undefined {
  try {
    return readPayPalWebhookId();
  } catch {
    return undefined;
  }
}

/**
 * PayPal retries any delivery that does not get a 2xx, so configuration and
 * upstream failures answer 503 and come back later, while forged or malformed
 * deliveries answer 400.
 */
export async function POST(request: Request): Promise<Response> {
  const webhookId = configuredWebhookId();
  if (webhookId === undefined) {
    console.error("paypal webhook rejected: PAYPAL_WEBHOOK_ID is not configured");
    return reply(503, { error: "webhook_not_configured" });
  }

  const rawEvent = await request.text();
  const transmission = readWebhookTransmission(request.headers);
  if (transmission === undefined) {
    return reply(400, { error: "missing_transmission_headers" });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawEvent);
  } catch {
    return reply(400, { error: "invalid_event" });
  }
  const event = webhookEventSchema.safeParse(parsedJson);
  if (!event.success) {
    return reply(400, { error: "invalid_event" });
  }

  let verified: boolean;
  try {
    verified = await verifyWebhookSignature(paypalRest(), { transmission, webhookId, rawEvent });
  } catch (error) {
    console.error("paypal webhook verification unavailable", {
      transmissionId: transmission["paypal-transmission-id"],
      error: error instanceof Error ? error.name : "unknown",
      debugId: error instanceof PayPalApiError ? error.debugId : undefined,
    });
    return reply(503, { error: "verification_unavailable" });
  }
  if (!verified) {
    console.warn("paypal webhook signature rejected", {
      transmissionId: transmission["paypal-transmission-id"],
    });
    return reply(400, { error: "signature_verification_failed" });
  }

  const handled = await dispatchWebhookEvent(event.data);
  return reply(200, { received: true, handled });
}
