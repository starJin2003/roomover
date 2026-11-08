import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PayPalApiError, PayPalResponseError } from "@/lib/paypal/errors";
import { createAppTokenSource, type FetchLike } from "@/lib/paypal/rest/app-token";
import { createPayPalRestClient } from "@/lib/paypal/rest/client";

const credentials = { clientId: "test-client-id", clientSecret: "test-client-secret" };
const TOKEN_URL = "https://api-m.sandbox.paypal.com/v1/oauth2/token";

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function tokenResponse(accessToken: string, expiresIn = 32_400): Response {
  return json(200, { access_token: accessToken, token_type: "Bearer", expires_in: expiresIn, app_id: "APP-1" });
}

type Call = { url: string; init: RequestInit };

/** A fetch stub that answers token requests and routes everything else to `api`. */
function fakePayPal(api: (call: Call) => Response, tokens: string[] = ["token-1", "token-2", "token-3"]) {
  const calls: Call[] = [];
  let issued = 0;
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url, init });
    if (url === TOKEN_URL) return tokenResponse(tokens[issued++] ?? "token-extra");
    return api({ url, init });
  });
  const apiCalls = () => calls.filter((call) => call.url !== TOKEN_URL);
  const tokenCalls = () => calls.filter((call) => call.url === TOKEN_URL);
  return { fetch, apiCalls, tokenCalls };
}

function header(call: Call, name: string): string | null {
  return new Headers(call.init.headers).get(name);
}

describe("app token cache", () => {
  it("requests a client credentials token with Basic auth", async () => {
    const paypal = fakePayPal(() => json(200, {}));
    const tokens = createAppTokenSource({ credentials, fetch: paypal.fetch });

    const token = await tokens.get();

    expect(token.accessToken).toBe("token-1");
    const [call] = paypal.tokenCalls();
    expect(call.init.method).toBe("POST");
    expect(call.init.body).toBe("grant_type=client_credentials");
    expect(header(call, "Authorization")).toBe(
      `Basic ${Buffer.from("test-client-id:test-client-secret").toString("base64")}`,
    );
  });

  it("reuses the cached token until the refresh margin", async () => {
    let now = 1_000_000;
    const paypal = fakePayPal(() => json(200, {}));
    const tokens = createAppTokenSource({
      credentials,
      fetch: paypal.fetch,
      now: () => now,
      refreshMarginMs: 5 * 60 * 1000,
    });

    expect((await tokens.get()).accessToken).toBe("token-1");
    now += 9 * 60 * 60 * 1000 - 5 * 60 * 1000 - 1;
    expect((await tokens.get()).accessToken).toBe("token-1");
    expect(paypal.tokenCalls()).toHaveLength(1);

    now += 1;
    expect((await tokens.get()).accessToken).toBe("token-2");
    expect(paypal.tokenCalls()).toHaveLength(2);
  });

  it("refreshes a short lived token at half its lifetime", async () => {
    let now = 0;
    const paypal = fakePayPal(() => json(200, {}));
    const fetch: FetchLike = async (url, init) =>
      url === TOKEN_URL ? tokenResponse(`short-${now}`, 60) : paypal.fetch(url, init);
    const tokens = createAppTokenSource({ credentials, fetch, now: () => now });

    expect((await tokens.get()).accessToken).toBe("short-0");
    now = 29_999;
    expect((await tokens.get()).accessToken).toBe("short-0");
    now = 30_000;
    expect((await tokens.get()).accessToken).toBe("short-30000");
  });

  it("shares one in-flight request between concurrent callers", async () => {
    const paypal = fakePayPal(() => json(200, {}));
    const tokens = createAppTokenSource({ credentials, fetch: paypal.fetch });

    const [a, b, c] = await Promise.all([tokens.get(), tokens.get(), tokens.get()]);

    expect(new Set([a.accessToken, b.accessToken, c.accessToken])).toEqual(new Set(["token-1"]));
    expect(paypal.tokenCalls()).toHaveLength(1);
  });

  it("does not cache a failed token request", async () => {
    let fail = true;
    const fetch: FetchLike = async () =>
      fail
        ? json(401, { error: "invalid_client", error_description: "Client Authentication failed" }, {
            "paypal-debug-id": "f1d9a3c2b7e45",
          })
        : tokenResponse("recovered");
    const tokens = createAppTokenSource({ credentials, fetch });

    const error = await tokens.get().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PayPalApiError);
    expect(error).toMatchObject({
      status: 401,
      errorName: "invalid_client",
      message: "Client Authentication failed",
      debugId: "f1d9a3c2b7e45",
    });

    fail = false;
    expect((await tokens.get()).accessToken).toBe("recovered");
  });

  it("keeps a newer token when an older one is invalidated", async () => {
    let now = 0;
    const paypal = fakePayPal(() => json(200, {}));
    const tokens = createAppTokenSource({ credentials, fetch: paypal.fetch, now: () => now });

    const first = await tokens.get();
    now = 10 * 60 * 60 * 1000;
    const second = await tokens.get();
    tokens.invalidate(first);

    expect(await tokens.get()).toBe(second);
  });
});

describe("PayPal REST client", () => {
  const schema = z.object({ id: z.string() });

  function client(api: (call: Call) => Response) {
    const paypal = fakePayPal(api);
    const tokens = createAppTokenSource({ credentials, fetch: paypal.fetch });
    return { paypal, rest: createPayPalRestClient({ credentials, tokens, fetch: paypal.fetch }) };
  }

  it("sends the app token and PayPal-Request-Id when a key is given", async () => {
    const { paypal, rest } = client(() => json(201, { id: "5UXD2E8A7EBQJ" }));

    const result = await rest.request({
      method: "POST",
      path: "/v1/payments/payouts",
      body: { kind: "json", value: { hello: "world" } },
      requestId: "rmv.payout.settlement-7.1",
      schema,
    });

    expect(result).toEqual({ id: "5UXD2E8A7EBQJ" });
    const [call] = paypal.apiCalls();
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v1/payments/payouts");
    expect(header(call, "Authorization")).toBe("Bearer token-1");
    expect(header(call, "PayPal-Request-Id")).toBe("rmv.payout.settlement-7.1");
    expect(header(call, "Content-Type")).toBe("application/json");
    expect(call.init.body).toBe('{"hello":"world"}');
  });

  it("omits PayPal-Request-Id when no key is given", async () => {
    const { paypal, rest } = client(() => json(200, { id: "PP-D-27803" }));

    await rest.request({ method: "GET", path: "/v1/customer/disputes/PP-D-27803", schema });

    expect(header(paypal.apiCalls()[0], "PayPal-Request-Id")).toBeNull();
  });

  it("reuses one token across requests", async () => {
    const { paypal, rest } = client(() => json(200, { id: "x" }));

    await rest.request({ method: "GET", path: "/v1/a", schema });
    await rest.request({ method: "GET", path: "/v1/b", schema });

    expect(paypal.tokenCalls()).toHaveLength(1);
    expect(paypal.apiCalls().map((call) => header(call, "Authorization"))).toEqual([
      "Bearer token-1",
      "Bearer token-1",
    ]);
  });

  it("drops a revoked token after a 401 and retries once with a new one", async () => {
    let attempts = 0;
    const { paypal, rest } = client(() =>
      attempts++ === 0 ? json(401, { name: "AUTHENTICATION_FAILURE", message: "Token expired" }) : json(200, { id: "ok" }),
    );

    await expect(rest.request({ method: "GET", path: "/v1/a", schema })).resolves.toEqual({ id: "ok" });
    expect(paypal.apiCalls().map((call) => header(call, "Authorization"))).toEqual([
      "Bearer token-1",
      "Bearer token-2",
    ]);
  });

  it("throws PayPalApiError with status, name, message, details, and the debug ID header", async () => {
    const { rest } = client(() =>
      json(
        422,
        {
          name: "UNPROCESSABLE_ENTITY",
          message: "The requested action could not be performed.",
          debug_id: "body-debug-id",
          details: [
            {
              field: "/items/0/receiver",
              location: "body",
              issue: "RECEIVER_UNREGISTERED",
              description: "Receiver is unregistered.",
            },
          ],
        },
        { "paypal-debug-id": "a1b2c3d4e5f6" },
      ),
    );

    const error = await rest
      .request({ method: "POST", path: "/v1/payments/payouts", body: { kind: "json", value: {} }, schema })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PayPalApiError);
    expect(error).toMatchObject({
      operation: "POST /v1/payments/payouts",
      status: 422,
      errorName: "UNPROCESSABLE_ENTITY",
      message: "The requested action could not be performed.",
      debugId: "a1b2c3d4e5f6",
      details: [{ issue: "RECEIVER_UNREGISTERED", field: "/items/0/receiver" }],
    });
  });

  it("falls back to the body debug_id and a generic name for a non-JSON error", async () => {
    const withBodyId = client(() => json(500, { name: "INTERNAL_SERVER_ERROR", message: "x", debug_id: "body-id" }));
    await expect(withBodyId.rest.request({ method: "GET", path: "/v1/a", schema })).rejects.toMatchObject({
      debugId: "body-id",
    });

    const html = client(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(html.rest.request({ method: "GET", path: "/v1/a", schema })).rejects.toMatchObject({
      status: 502,
      errorName: "HTTP_502",
      details: [],
    });
  });

  it("throws PayPalResponseError when a 2xx body does not match the schema", async () => {
    const { rest } = client(() => json(200, { id: 42 }, { "paypal-debug-id": "shape-debug" }));

    const error = await rest.request({ method: "GET", path: "/v1/a", schema }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PayPalResponseError);
    expect(error).toMatchObject({ debugId: "shape-debug", paths: ["id"] });
  });

  it("sends jsonText bytes unchanged", async () => {
    const { paypal, rest } = client(() => json(200, { id: "x" }));
    const text = '{"amount":1.0,"note":"caf\\u00e9"}';

    await rest.request({ method: "POST", path: "/v1/a", body: { kind: "jsonText", text }, schema });

    expect(paypal.apiCalls()[0].init.body).toBe(text);
  });
});
