import { describe, expect, it } from "vitest";
import { PayPalApiError } from "@/lib/paypal/errors";
import type { AppTokenSource } from "@/lib/paypal/rest/app-token";
import { createPayPalSdk } from "@/lib/paypal/server-sdk/client";
import { approvalLink, buildOrderRequest, createOrder, type CreateOrderInput } from "@/lib/paypal/server-sdk/orders";
import { captureAuthorization } from "@/lib/paypal/server-sdk/payments";
import { searchTransactions } from "@/lib/paypal/server-sdk/transactions";

interface AxiosLikeRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  data?: string;
}

const credentials = { clientId: "test-client-id", clientSecret: "test-client-secret" };

const staticTokens: AppTokenSource = {
  get: async () => ({ accessToken: "sdk-token", refreshAt: Date.now() + 60 * 60 * 1000 }),
  invalidate: () => undefined,
};

function sdkReturning(status: number, body: unknown, headers: Record<string, string> = {}) {
  const requests: AxiosLikeRequest[] = [];
  const sdk = createPayPalSdk({
    credentials,
    tokens: staticTokens,
    transportOverrides: {
      adapter: async (config) => {
        requests.push(config as AxiosLikeRequest);
        return {
          data: JSON.stringify(body),
          status,
          statusText: "",
          headers: { "content-type": "application/json", ...headers },
          config,
        };
      },
    },
  });
  return { sdk, requests };
}

function headerOf(request: AxiosLikeRequest, name: string): string | undefined {
  const key = Object.keys(request.headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : request.headers[key];
}

const cart: CreateOrderInput = {
  intent: "AUTHORIZE",
  referenceId: "order_8",
  returnUrl: "http://127.0.0.1:3000/checkout/return",
  cancelUrl: "http://127.0.0.1:3000/checkout/cancel",
  items: [
    { name: "Desk lamp", unitAmountCents: 1_800, quantity: 1, sku: "listing_1" },
    { name: "Storage bin", unitAmountCents: 650, quantity: 2, sku: "listing_2" },
  ],
};

describe("buildOrderRequest", () => {
  it("totals the items in cents and states the item total breakdown", () => {
    const request = buildOrderRequest(cart);
    const [unit] = request.purchaseUnits;

    expect(request.intent).toBe("AUTHORIZE");
    expect(unit.amount).toEqual({
      currencyCode: "USD",
      value: "31.00",
      breakdown: { itemTotal: { currencyCode: "USD", value: "31.00" } },
    });
    expect(unit.items?.map((item) => [item.unitAmount.value, item.quantity])).toEqual([
      ["18.00", "1"],
      ["6.50", "2"],
    ]);
  });

  it("rejects an empty cart and fractional quantities before any request", () => {
    expect(() => buildOrderRequest({ ...cart, items: [] })).toThrow(RangeError);
    expect(() =>
      buildOrderRequest({ ...cart, items: [{ name: "Rug", unitAmountCents: 1_000, quantity: 1.5 }] }),
    ).toThrow(RangeError);
  });
});

describe("Server SDK wrappers", () => {
  it("creates an order with the shared app token and the idempotency key", async () => {
    const { sdk, requests } = sdkReturning(201, {
      id: "5O190127TN364715T",
      status: "PAYER_ACTION_REQUIRED",
      links: [{ href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T", rel: "payer-action" }],
    });

    const order = await createOrder(sdk, cart, "rmv.order-create.order_8.1");

    expect(order.id).toBe("5O190127TN364715T");
    expect(approvalLink(order)).toBe("https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T");
    const [request] = requests;
    expect(request.url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    expect(headerOf(request, "authorization")).toBe("Bearer sdk-token");
    expect(headerOf(request, "paypal-request-id")).toBe("rmv.order-create.order_8.1");
    expect(JSON.parse(request.data ?? "{}")).toMatchObject({
      intent: "AUTHORIZE",
      purchase_units: [{ reference_id: "order_8", amount: { currency_code: "USD", value: "31.00" } }],
      payment_source: { paypal: { experience_context: { shipping_preference: "NO_SHIPPING" } } },
    });
  });

  it("sends a partial capture amount and final_capture", async () => {
    const { sdk, requests } = sdkReturning(201, { id: "2GG279541U471931P", status: "COMPLETED" });

    await captureAuthorization(
      sdk,
      "0VF52814937998046",
      { amountCents: 1_800, finalCapture: false, invoiceId: "order_8-item_1" },
      "rmv.capture.item_1.1",
    );

    const [request] = requests;
    expect(request.url).toBe("https://api-m.sandbox.paypal.com/v2/payments/authorizations/0VF52814937998046/capture");
    expect(headerOf(request, "paypal-request-id")).toBe("rmv.capture.item_1.1");
    expect(JSON.parse(request.data ?? "{}")).toEqual({
      amount: { currency_code: "USD", value: "18.00" },
      final_capture: false,
      invoice_id: "order_8-item_1",
    });
  });

  it("translates an SDK error into PayPalApiError with the debug ID header and sends it once", async () => {
    const { sdk, requests } = sdkReturning(
      422,
      {
        name: "UNPROCESSABLE_ENTITY",
        message: "The requested action could not be performed.",
        debug_id: "body-debug",
        details: [{ issue: "AUTHORIZATION_ALREADY_CAPTURED", description: "Authorization has been previously captured." }],
      },
      { "paypal-debug-id": "header-debug" },
    );

    const error = await captureAuthorization(sdk, "0VF52814937998046", { finalCapture: true }, "rmv.capture.item_1.2").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(PayPalApiError);
    expect(error).toMatchObject({
      operation: "POST /v2/payments/authorizations/{id}/capture",
      status: 422,
      errorName: "UNPROCESSABLE_ENTITY",
      debugId: "header-debug",
      details: [{ issue: "AUTHORIZATION_ALREADY_CAPTURED" }],
    });
    expect(requests).toHaveLength(1);
  });

  it("searches transactions with whole second dates and refuses windows over 31 days", async () => {
    const { sdk, requests } = sdkReturning(200, { transaction_details: [], total_items: 0 });
    const end = new Date("2026-11-08T12:00:00.123Z");
    const start = new Date(end.getTime() - 31 * 24 * 60 * 60 * 1000);

    await searchTransactions(sdk, { start, end, pageSize: 100 });

    const query = new URL(requests[0].url).searchParams;
    expect(query.get("start_date")).toBe("2026-10-08T12:00:00Z");
    expect(query.get("end_date")).toBe("2026-11-08T12:00:00Z");
    expect(query.get("fields")).toBe("all");
    expect(() => searchTransactions(sdk, { start: new Date(start.getTime() - 1), end })).toThrow(RangeError);
    expect(() => searchTransactions(sdk, { start: end, end: start })).toThrow(RangeError);
  });

  it("surfaces a token failure before any SDK request", async () => {
    const tokenFailure = new PayPalApiError({
      operation: "POST /v1/oauth2/token",
      status: 401,
      errorName: "invalid_client",
      message: "Client Authentication failed",
      details: [],
      debugId: "token-debug",
    });
    const requests: unknown[] = [];
    const sdk = createPayPalSdk({
      credentials,
      tokens: { get: () => Promise.reject(tokenFailure), invalidate: () => undefined },
      transportOverrides: {
        adapter: async (config) => {
          requests.push(config);
          throw new Error("unreachable");
        },
      },
    });

    await expect(createOrder(sdk, cart, "rmv.order-create.order_8.1")).rejects.toBe(tokenFailure);
    expect(requests).toHaveLength(0);
  });
});
