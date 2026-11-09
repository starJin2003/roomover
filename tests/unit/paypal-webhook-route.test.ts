import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PayPalWebhookEvent } from "@/lib/paypal/webhooks/events";

// Stands in for webhook_events. The real store runs the same insert-or-skip
// on the unique PayPal event ID inside a transaction.
const store = vi.hoisted(() => ({ eventIds: [] as string[], failing: false }));

vi.mock("@/lib/paypal/webhooks/store", () => ({
  recordWebhookEvent: async (event: PayPalWebhookEvent, dispatch: (event: PayPalWebhookEvent) => Promise<boolean>) => {
    if (store.failing) throw new Error("connection terminated");
    if (store.eventIds.includes(event.id)) return { duplicate: true };
    store.eventIds.push(event.id);
    return { duplicate: false, handled: await dispatch(event) };
  },
}));

const TOKEN_URL = "https://api-m.sandbox.paypal.com/v1/oauth2/token";
const VERIFY_URL = "https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature";
const WEBHOOK_ID = "8PT597110X687430LKGECATA";

// Byte for byte what PayPal sent, including formatting JSON.stringify would not reproduce.
const RAW_EVENT =
  '{"id":"WH-58D329510W468432D-8HN650336L201105X","event_version":"1.0","create_time":"2026-11-08T12:00:00.000Z",' +
  '"resource_type":"capture","event_type":"PAYMENT.CAPTURE.COMPLETED","summary":"Payment completed for $ 18.0 USD",' +
  '"resource":{"id":"2GG279541U471931P","amount":{"currency_code":"USD","value":"18.00"},"seller_receivable_breakdown":{"paypal_fee":{"value":1.0}}}}';

const TRANSMISSION_HEADERS = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77",
  "paypal-transmission-id": "103e3700-8e1f-11ee-9a5b-1b7d0c7fe2d2",
  "paypal-transmission-sig": "c2lnbmF0dXJl",
  "paypal-transmission-time": "2026-11-08T12:00:01Z",
};

type FetchCall = { url: string; init: RequestInit };

function stubPayPal(verification: () => Response) {
  const calls: FetchCall[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url === TOKEN_URL) {
      return Response.json({ access_token: "token-1", token_type: "Bearer", expires_in: 32_400 });
    }
    if (url === VERIFY_URL) return verification();
    throw new Error(`Unexpected request to ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  return calls;
}

function delivery(body = RAW_EVENT, headers: Record<string, string> = TRANSMISSION_HEADERS): Request {
  return new Request("http://127.0.0.1:3000/api/paypal/webhooks", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

async function loadRoute() {
  // Fresh modules give each test its own token cache and REST client.
  vi.resetModules();
  return import("@/app/api/paypal/webhooks/route");
}

describe("POST /api/paypal/webhooks", () => {
  beforeEach(() => {
    store.eventIds = [];
    store.failing = false;
    vi.stubEnv("PAYPAL_CLIENT_ID", "test-client-id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("PAYPAL_WEBHOOK_ID", WEBHOOK_ID);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fails closed with 503 when PAYPAL_WEBHOOK_ID is missing", async () => {
    vi.stubEnv("PAYPAL_WEBHOOK_ID", undefined);
    const calls = stubPayPal(() => Response.json({ verification_status: "SUCCESS" }));
    const { POST } = await loadRoute();

    const response = await POST(delivery());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "webhook_not_configured" });
    expect(calls).toHaveLength(0);
  });

  it("fails closed with 503 when PAYPAL_WEBHOOK_ID is still the placeholder", async () => {
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "your-sandbox-webhook-id");
    const calls = stubPayPal(() => Response.json({ verification_status: "SUCCESS" }));
    const { POST } = await loadRoute();

    const response = await POST(delivery());

    expect(response.status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it("answers 400 when PayPal reports the signature as invalid", async () => {
    stubPayPal(() => Response.json({ verification_status: "FAILURE" }));
    const { POST } = await loadRoute();

    const response = await POST(delivery());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "signature_verification_failed" });
    expect(console.info).not.toHaveBeenCalled();
    expect(store.eventIds).toEqual([]);
  });

  it("answers 200 for a verified event, stores it, and dispatches it", async () => {
    const calls = stubPayPal(() => Response.json({ verification_status: "SUCCESS" }));
    const { POST } = await loadRoute();

    const response = await POST(delivery());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: false, handled: true });
    expect(store.eventIds).toEqual(["WH-58D329510W468432D-8HN650336L201105X"]);
    // The capture names no order, so the checkout handler acknowledges it and moves nothing.
    expect(console.warn).toHaveBeenCalledWith("paypal webhook capture without an order", { eventId: "WH-58D329510W468432D-8HN650336L201105X" });

    const verify = calls.find((call) => call.url === VERIFY_URL);
    expect(new Headers(verify?.init.headers).get("Authorization")).toBe("Bearer token-1");
    const sent = String(verify?.init.body);
    expect(sent.endsWith(`"webhook_event":${RAW_EVENT}}`)).toBe(true);
    expect(JSON.parse(sent)).toMatchObject({
      auth_algo: "SHA256withRSA",
      cert_url: TRANSMISSION_HEADERS["paypal-cert-url"],
      transmission_id: TRANSMISSION_HEADERS["paypal-transmission-id"],
      transmission_sig: TRANSMISSION_HEADERS["paypal-transmission-sig"],
      transmission_time: TRANSMISSION_HEADERS["paypal-transmission-time"],
      webhook_id: WEBHOOK_ID,
    });
  });

  it("answers 200 for a replayed event without storing or dispatching it again", async () => {
    stubPayPal(() => Response.json({ verification_status: "SUCCESS" }));
    const { POST } = await loadRoute();

    await POST(delivery());
    vi.mocked(console.info).mockClear();
    const replay = await POST(delivery());

    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ received: true, duplicate: true });
    expect(store.eventIds).toHaveLength(1);
    expect(console.info).not.toHaveBeenCalledWith("paypal webhook", expect.anything());
  });

  it("answers 503 so PayPal redelivers when the event cannot be stored", async () => {
    store.failing = true;
    stubPayPal(() => Response.json({ verification_status: "SUCCESS" }));
    const { POST } = await loadRoute();

    const response = await POST(delivery());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "storage_unavailable" });
    expect(console.info).not.toHaveBeenCalled();
  });

  it("stores and acknowledges a verified event type Roomover does not subscribe to", async () => {
    stubPayPal(() => Response.json({ verification_status: "SUCCESS" }));
    const { POST } = await loadRoute();
    const event = RAW_EVENT.replace("PAYMENT.CAPTURE.COMPLETED", "CHECKOUT.ORDER.APPROVED");

    const response = await POST(delivery(event));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: false, handled: false });
    expect(store.eventIds).toHaveLength(1);
  });

  it("answers 400 without calling PayPal when transmission headers are missing", async () => {
    const calls = stubPayPal(() => Response.json({ verification_status: "SUCCESS" }));
    const { POST } = await loadRoute();
    const headers: Record<string, string> = { ...TRANSMISSION_HEADERS };
    delete headers["paypal-transmission-sig"];

    const response = await POST(delivery(RAW_EVENT, headers));

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it.each([
    "not json",
    "[]",
    '{"id":"WH-1"}',
    '{"id":"WH-1","event_type":"PAYMENT.CAPTURE.COMPLETED","create_time":"yesterday","resource":{}}',
  ])("answers 400 for the malformed body %j", async (body) => {
    const calls = stubPayPal(() => Response.json({ verification_status: "SUCCESS" }));
    const { POST } = await loadRoute();

    const response = await POST(delivery(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_event" });
    expect(calls).toHaveLength(0);
  });

  it("answers 503 so PayPal redelivers when verification itself fails", async () => {
    stubPayPal(() =>
      Response.json({ name: "INTERNAL_SERVICE_ERROR", message: "An internal service error occurred." }, { status: 500 }),
    );
    const { POST } = await loadRoute();

    const response = await POST(delivery());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "verification_unavailable" });
  });
});
