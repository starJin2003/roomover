import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppTokenSource, type FetchLike } from "@/lib/paypal/rest/app-token";
import { createPayPalRestClient } from "@/lib/paypal/rest/client";
import { ensureWebhook, type PayPalWebhook } from "@/lib/paypal/rest/webhooks";
import { dispatchWebhookEvent } from "@/lib/paypal/webhooks/dispatch";
import { PAYPAL_WEBHOOK_EVENT_TYPES, webhookResourceId, type PayPalWebhookEvent } from "@/lib/paypal/webhooks/events";

const credentials = { clientId: "test-client-id", clientSecret: "test-client-secret" };
const TOKEN_URL = "https://api-m.sandbox.paypal.com/v1/oauth2/token";
const WEBHOOKS_URL = "https://api-m.sandbox.paypal.com/v1/notifications/webhooks";
const HOOK_URL = "https://roomover.onrender.com/api/paypal/webhooks";

type Call = { method: string; url: string; body: unknown };

function paypalWithWebhooks(existing: PayPalWebhook[]) {
  const calls: Call[] = [];
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    if (url === TOKEN_URL) return Response.json({ access_token: "app-token", token_type: "Bearer", expires_in: 32_400 });
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    if (method === "GET") return Response.json({ webhooks: existing });
    if (method === "POST") return Response.json({ id: "4JH86294D6297924G", url: body.url, event_types: body.event_types }, { status: 201 });
    const id = url.split("/").at(-1) ?? "";
    return Response.json({ id, url: HOOK_URL, event_types: body[0].value });
  });
  const tokens = createAppTokenSource({ credentials, fetch });
  return { rest: createPayPalRestClient({ credentials, tokens, fetch }), calls };
}

const hook = (id: string, url: string, names: readonly string[]): PayPalWebhook => ({
  id,
  url,
  event_types: names.map((name) => ({ name })),
});

describe("ensureWebhook", () => {
  it("creates the webhook when no webhook points at the URL", async () => {
    const { rest, calls } = paypalWithWebhooks([hook("1AB23456CD789012E", "https://old.example.com/hooks", ["PAYMENT.CAPTURE.COMPLETED"])]);

    const result = await ensureWebhook(rest, { url: HOOK_URL, eventTypes: PAYPAL_WEBHOOK_EVENT_TYPES });

    expect(result.action).toBe("created");
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET ${WEBHOOKS_URL}?anchor_type=APPLICATION`,
      `POST ${WEBHOOKS_URL}`,
    ]);
    expect(calls[1]?.body).toEqual({ url: HOOK_URL, event_types: PAYPAL_WEBHOOK_EVENT_TYPES.map((name) => ({ name })) });
  });

  it("replaces the event list of the existing webhook for the URL", async () => {
    const { rest, calls } = paypalWithWebhooks([hook("8PT597110X687430L", HOOK_URL, PAYPAL_WEBHOOK_EVENT_TYPES.slice(0, 15))]);

    const result = await ensureWebhook(rest, { url: HOOK_URL, eventTypes: PAYPAL_WEBHOOK_EVENT_TYPES });

    expect(result.action).toBe("updated");
    expect(result.webhook.id).toBe("8PT597110X687430L");
    expect(calls.at(-1)?.method).toBe("PATCH");
    expect(calls.at(-1)?.url).toBe(`${WEBHOOKS_URL}/8PT597110X687430L`);
    expect(calls.at(-1)?.body).toEqual([
      { op: "replace", path: "/event_types", value: PAYPAL_WEBHOOK_EVENT_TYPES.map((name) => ({ name })) },
    ]);
  });

  it("writes nothing when the webhook already has the same events in any order", async () => {
    const { rest, calls } = paypalWithWebhooks([hook("8PT597110X687430L", HOOK_URL, [...PAYPAL_WEBHOOK_EVENT_TYPES].reverse())]);

    const result = await ensureWebhook(rest, { url: HOOK_URL, eventTypes: PAYPAL_WEBHOOK_EVENT_TYPES });

    expect(result.action).toBe("unchanged");
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });
});

describe("webhook event list", () => {
  afterEach(() => vi.restoreAllMocks());

  it("subscribes to 20 distinct events, including the capture, payout batch, and dispute outcomes", () => {
    expect(PAYPAL_WEBHOOK_EVENT_TYPES).toHaveLength(20);
    expect(new Set(PAYPAL_WEBHOOK_EVENT_TYPES).size).toBe(20);
    expect(PAYPAL_WEBHOOK_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        "CUSTOMER.DISPUTE.RESOLVED",
        "PAYMENT.PAYOUTSBATCH.DENIED",
        "PAYMENT.CAPTURE.DECLINED",
        "PAYMENT.CAPTURE.PENDING",
        "PAYMENT.CAPTURE.REVERSED",
      ]),
    );
  });

  it.each(PAYPAL_WEBHOOK_EVENT_TYPES)("has a handler for %s", async (eventType) => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const event: PayPalWebhookEvent = { id: "WH-1", event_type: eventType, create_time: "2026-11-08T12:00:00Z", resource: {} };
    await expect(dispatchWebhookEvent(event)).resolves.toBe(true);
  });
});

describe("webhookResourceId", () => {
  const event = (resource: Record<string, unknown>): PayPalWebhookEvent => ({
    id: "WH-1",
    event_type: "PAYMENT.PAYOUTSBATCH.SUCCESS",
    create_time: "2026-11-08T12:00:00Z",
    resource,
  });

  it("reads the ID where each resource keeps it", () => {
    expect(webhookResourceId(event({ id: "2GG279541U471931P" }))).toBe("2GG279541U471931P");
    expect(webhookResourceId(event({ payout_item_id: "8AELMXH8UB2P8", payout_batch_id: "5UXD2E8A7EBQJ" }))).toBe("8AELMXH8UB2P8");
    expect(webhookResourceId(event({ batch_header: { payout_batch_id: "5UXD2E8A7EBQJ", batch_status: "SUCCESS" } }))).toBe(
      "5UXD2E8A7EBQJ",
    );
  });

  it("returns null when the resource names no ID", () => {
    expect(webhookResourceId(event({}))).toBeNull();
    expect(webhookResourceId(event({ id: 42 }))).toBeNull();
  });
});
