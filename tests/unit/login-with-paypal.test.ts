import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOf, nameOf, payerIdOf } from "@/lib/paypal/rest/identity";
import { checkLoginState, LOGIN_STATE_COOKIE, signLoginState, signSeller, verifySeller } from "@/lib/seller-session";

const SECRET = "s".repeat(32);
const NOW = new Date("2026-11-09T18:00:00Z");
const SELLER_ID = "3f1c3c84-9c7e-5f4e-9a54-1b2c3d4e5f60";

const state = vi.hoisted(() => ({
  linked: [] as { payerId: string; email: string | null; name: string | null }[],
  link: { ok: true, userId: "3f1c3c84-9c7e-5f4e-9a54-1b2c3d4e5f60", created: false } as { ok: true; userId: string; created: boolean } | { ok: false; reason: "platform" | "no_account" },
  userinfo: {} as Record<string, unknown>,
  tokenStatus: 200,
}));

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => undefined }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/db/sellers", () => ({
  linkPayPalSeller: async (_db: unknown, input: { payerId: string; email: string | null; name: string | null }) => {
    state.linked.push(input);
    return state.link;
  },
}));

function stubPayPal() {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url === "https://api-m.sandbox.paypal.com/v1/oauth2/token") {
        return state.tokenStatus === 200 ? Response.json({ access_token: "user-token", token_type: "Bearer", expires_in: "28800", refresh_token: "r" }) : Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      if (url.startsWith("https://api-m.sandbox.paypal.com/v1/identity/oauth2/userinfo")) return Response.json(state.userinfo);
      throw new Error(`Unexpected request to ${url}`);
    }),
  );
  return calls;
}

function callback(query: string, cookies: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(`http://127.0.0.1:3000/api/auth/paypal/callback?${query}`, { headers: cookie === "" ? {} : { cookie } });
}

const STATE = "abcdefghijklmnopqrstuvwx";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("PAYPAL_CLIENT_ID", "test-client-id");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
  vi.stubEnv("ROOMOVER_PAYPAL_FIXTURE", "");
  state.linked = [];
  state.link = { ok: true, userId: SELLER_ID, created: false };
  state.userinfo = { user_id: "https://www.paypal.com/webapps/auth/identity/user/abc", name: "Ava Lindqvist", payer_id: "6Q7LQ8XZHM8VS", emails: [{ value: "Roomover-Seller1-jin0608@personal.example.com", primary: true }] };
  state.tokenStatus = 200;
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/auth/paypal/login", () => {
  it("sends the seller to PayPal with the app's scopes and a state it also keeps in a signed cookie", async () => {
    const { GET } = await import("@/app/api/auth/paypal/login/route");
    const response = await GET();
    const target = new URL(response.headers.get("location") ?? "");
    expect(response.status).toBe(303);
    expect(`${target.origin}${target.pathname}`).toBe("https://www.sandbox.paypal.com/connect");
    expect(target.searchParams.get("scope")).toBe("openid profile email https://uri.paypal.com/services/paypalattributes");
    expect(target.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:3000/api/auth/paypal/callback");
    const state = target.searchParams.get("state");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${LOGIN_STATE_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/api/auth/paypal");
    const value = decodeURIComponent(cookie.split(";")[0].split("=").slice(1).join("="));
    expect(checkLoginState(value, state, SECRET)).toBe(true);
  });
});

describe("GET /api/auth/paypal/callback", () => {
  const signed = { [LOGIN_STATE_COOKIE]: signLoginState(STATE, SECRET) };

  it("trades the code, reads the payer ID, stores it on the seller, and signs the seller in", async () => {
    const calls = stubPayPal();
    const { GET } = await import("@/app/api/auth/paypal/callback/route");
    const response = await GET(callback(`code=real-code&state=${STATE}`, signed));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/sell");
    expect(state.linked).toEqual([{ payerId: "6Q7LQ8XZHM8VS", email: "roomover-seller1-jin0608@personal.example.com", name: "Ava Lindqvist" }]);
    expect(calls.map((call) => call.url.split("?")[0])).toEqual(["https://api-m.sandbox.paypal.com/v1/oauth2/token", "https://api-m.sandbox.paypal.com/v1/identity/oauth2/userinfo"]);
    expect(String(calls[0].init.body)).toBe("grant_type=authorization_code&code=real-code");
    expect(new Headers(calls[1].init.headers).get("Authorization")).toBe("Bearer user-token");
    const cookies = response.headers.getSetCookie();
    const seller = cookies.find((cookie) => cookie.startsWith("roomover_seller="));
    expect(seller).toBeDefined();
    expect(verifySeller(decodeURIComponent(seller?.split(";")[0].split("=").slice(1).join("=") ?? ""), SECRET, new Date())).toBe(SELLER_ID);
    expect(cookies.some((cookie) => cookie.startsWith("roomover_session="))).toBe(true);
  });

  it("refuses a state that does not match the cookie, and sends nothing to PayPal", async () => {
    const calls = stubPayPal();
    const { GET } = await import("@/app/api/auth/paypal/callback/route");
    const wrong = await GET(callback(`code=real-code&state=zyxwvutsrqponmlkjihgfedc`, signed));
    const missing = await GET(callback(`code=real-code&state=${STATE}`));
    expect([wrong.headers.get("location"), missing.headers.get("location")]).toEqual(["http://127.0.0.1:3000/sell?login=failed", "http://127.0.0.1:3000/sell?login=failed"]);
    expect(calls).toEqual([]);
    expect(state.linked).toEqual([]);
  });

  it("names each way the round trip can end without a seller", async () => {
    stubPayPal();
    const { GET } = await import("@/app/api/auth/paypal/callback/route");
    const location = async (query: string) => (await GET(callback(query, signed))).headers.get("location");
    expect(await location(`error=access_denied&state=${STATE}`)).toBe("http://127.0.0.1:3000/sell?login=canceled");
    state.tokenStatus = 400;
    expect(await location(`code=old-code&state=${STATE}`)).toBe("http://127.0.0.1:3000/sell?login=failed");
    state.tokenStatus = 200;
    state.userinfo = { user_id: "https://www.paypal.com/webapps/auth/identity/user/abc", name: "Ava" };
    state.link = { ok: false, reason: "no_account" };
    expect(await location(`code=real-code&state=${STATE}`)).toBe("http://127.0.0.1:3000/sell?login=no_account");
    state.userinfo = { payer_id: "6Q7LQ8XZHM8VS" };
    state.link = { ok: false, reason: "platform" };
    expect(await location(`code=real-code&state=${STATE}`)).toBe("http://127.0.0.1:3000/sell?login=platform");
  });
});

describe("the sandbox's own userinfo", () => {
  it("links the seller by email when PayPal names no payer ID, as the sandbox answered on 2026-11-09", async () => {
    stubPayPal();
    state.userinfo = { user_id: "https://www.paypal.com/webapps/auth/identity/user/abc", sub: "https://www.paypal.com/webapps/auth/identity/user/abc", name: "Ava Lindqvist", emails: [{ value: "roomover-seller1-jin0608@personal.example.com", primary: true, confirmed: true }] };
    const { GET } = await import("@/app/api/auth/paypal/callback/route");
    const response = await GET(callback(`code=real-code&state=${STATE}`, { [LOGIN_STATE_COOKIE]: signLoginState(STATE, SECRET) }));
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/sell");
    expect(state.linked).toEqual([{ payerId: null, email: "roomover-seller1-jin0608@personal.example.com", name: "Ava Lindqvist" }]);
  });
});

describe("Log in with PayPal userinfo", () => {
  it("finds the payer ID in payer_id, user_id, or sub, and never in a URL style user ID", () => {
    expect(payerIdOf({ payer_id: "6Q7LQ8XZHM8VS" })).toEqual({ payerId: "6Q7LQ8XZHM8VS", field: "payer_id" });
    expect(payerIdOf({ user_id: "6Q7LQ8XZHM8VS" })).toEqual({ payerId: "6Q7LQ8XZHM8VS", field: "user_id" });
    expect(payerIdOf({ sub: "6Q7LQ8XZHM8VS" })).toEqual({ payerId: "6Q7LQ8XZHM8VS", field: "sub" });
    expect(payerIdOf({ user_id: "https://www.paypal.com/webapps/auth/identity/user/6Q7LQ8XZHM8VS" })).toBeNull();
  });

  it("reads the primary email in lowercase and the full name from either shape", () => {
    expect(emailOf({ emails: [{ value: "Other@example.com" }, { value: "Main@Example.com", primary: true }] })).toBe("main@example.com");
    expect(emailOf({ email: "solo@example.com" })).toBe("solo@example.com");
    expect(emailOf({})).toBeNull();
    expect(nameOf({ given_name: "Ava", family_name: "Lindqvist" })).toBe("Ava Lindqvist");
    expect(nameOf({})).toBeNull();
  });
});

describe("the seller cookie", () => {
  it("signs the seller for a week under its own label", () => {
    const cookie = signSeller(SELLER_ID, SECRET, NOW);
    expect(verifySeller(cookie, SECRET, NOW)).toBe(SELLER_ID);
    expect(verifySeller(cookie, SECRET, new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000))).toBeNull();
    expect(verifySeller(cookie, "t".repeat(32), NOW)).toBeNull();
    expect(verifySeller(cookie.replace(SELLER_ID, "00000000-0000-0000-0000-000000000000"), SECRET, NOW)).toBeNull();
    expect(verifySeller(undefined, SECRET, NOW)).toBeNull();
  });
});
