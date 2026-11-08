import { z } from "zod";
import type { PayPalRestClient } from "@/lib/paypal/rest/client";

/** The transmission headers PayPal sends with every webhook delivery. */
const transmissionHeadersSchema = z.object({
  "paypal-auth-algo": z.string().min(1),
  "paypal-cert-url": z.url({ protocol: /^https$/ }),
  "paypal-transmission-id": z.string().min(1),
  "paypal-transmission-sig": z.string().min(1),
  "paypal-transmission-time": z.string().min(1),
});

export type WebhookTransmission = z.infer<typeof transmissionHeadersSchema>;

export function readWebhookTransmission(headers: Headers): WebhookTransmission | undefined {
  const parsed = transmissionHeadersSchema.safeParse({
    "paypal-auth-algo": headers.get("paypal-auth-algo"),
    "paypal-cert-url": headers.get("paypal-cert-url"),
    "paypal-transmission-id": headers.get("paypal-transmission-id"),
    "paypal-transmission-sig": headers.get("paypal-transmission-sig"),
    "paypal-transmission-time": headers.get("paypal-transmission-time"),
  });
  return parsed.success ? parsed.data : undefined;
}

const verificationSchema = z.object({ verification_status: z.enum(["SUCCESS", "FAILURE"]) });

/**
 * Asks PayPal whether a delivery is authentic. `rawEvent` must be the request
 * body exactly as received and already known to be a JSON object. It is
 * embedded verbatim because re-serializing parsed JSON can change number
 * formatting or escaping, and PayPal checks the signature over the original
 * bytes.
 */
export async function verifyWebhookSignature(
  rest: PayPalRestClient,
  input: { transmission: WebhookTransmission; webhookId: string; rawEvent: string },
): Promise<boolean> {
  const { transmission } = input;
  const fields = JSON.stringify({
    auth_algo: transmission["paypal-auth-algo"],
    cert_url: transmission["paypal-cert-url"],
    transmission_id: transmission["paypal-transmission-id"],
    transmission_sig: transmission["paypal-transmission-sig"],
    transmission_time: transmission["paypal-transmission-time"],
    webhook_id: input.webhookId,
  });
  const text = `${fields.slice(0, -1)},"webhook_event":${input.rawEvent}}`;

  const result = await rest.request({
    method: "POST",
    path: "/v1/notifications/verify-webhook-signature",
    body: { kind: "jsonText", text },
    schema: verificationSchema,
  });
  return result.verification_status === "SUCCESS";
}

const webhookSchema = z.object({
  id: z.string(),
  url: z.string(),
  event_types: z.array(z.object({ name: z.string() })),
});

export type PayPalWebhook = z.infer<typeof webhookSchema>;

export function createWebhook(
  rest: PayPalRestClient,
  input: { url: string; eventTypes: readonly string[] },
): Promise<PayPalWebhook> {
  return rest.request({
    method: "POST",
    path: "/v1/notifications/webhooks",
    body: { kind: "json", value: { url: input.url, event_types: input.eventTypes.map((name) => ({ name })) } },
    schema: webhookSchema,
  });
}

export async function listWebhooks(rest: PayPalRestClient): Promise<PayPalWebhook[]> {
  const result = await rest.request({
    method: "GET",
    path: "/v1/notifications/webhooks",
    query: { anchor_type: "APPLICATION" },
    schema: z.object({ webhooks: z.array(webhookSchema) }),
  });
  return result.webhooks;
}

/** PayPal's update call accepts only `replace` operations, here on the event list. */
export function updateWebhookEventTypes(
  rest: PayPalRestClient,
  webhookId: string,
  eventTypes: readonly string[],
): Promise<PayPalWebhook> {
  return rest.request({
    method: "PATCH",
    path: `/v1/notifications/webhooks/${encodeURIComponent(webhookId)}`,
    body: {
      kind: "json",
      value: [{ op: "replace", path: "/event_types", value: eventTypes.map((name) => ({ name })) }],
    },
    schema: webhookSchema,
  });
}

export interface WebhookRegistration {
  readonly action: "created" | "updated" | "unchanged";
  readonly webhook: PayPalWebhook;
}

const sameEventTypes = (webhook: PayPalWebhook, eventTypes: readonly string[]) => {
  const current = new Set(webhook.event_types.map((type) => type.name));
  return current.size === new Set(eventTypes).size && eventTypes.every((name) => current.has(name));
};

/**
 * Keeps one webhook per URL on the app. An existing webhook for the URL gets
 * its event list replaced when it differs, and a new one is created only
 * when none exists, so running this again changes nothing.
 */
export async function ensureWebhook(
  rest: PayPalRestClient,
  input: { url: string; eventTypes: readonly string[] },
): Promise<WebhookRegistration> {
  const existing = (await listWebhooks(rest)).find((webhook) => webhook.url === input.url);
  if (existing === undefined) {
    return { action: "created", webhook: await createWebhook(rest, input) };
  }
  if (sameEventTypes(existing, input.eventTypes)) {
    return { action: "unchanged", webhook: existing };
  }
  return { action: "updated", webhook: await updateWebhookEventTypes(rest, existing.id, input.eventTypes) };
}
