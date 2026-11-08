import { describe, expect, it, vi } from "vitest";
import { createAppTokenSource, type FetchLike } from "@/lib/paypal/rest/app-token";
import { createPayPalRestClient } from "@/lib/paypal/rest/client";
import { provideDisputeEvidence } from "@/lib/paypal/rest/disputes";
import { exchangeAuthorizationCode, getUserInfo, loginWithPayPalUrl } from "@/lib/paypal/rest/identity";
import { createPayoutBatch, getPayoutBatch, type PayoutItemInput } from "@/lib/paypal/rest/payouts";
import { createWebhook } from "@/lib/paypal/rest/webhooks";
import { readLoginWithPayPalRedirectUri } from "@/lib/paypal/config";
import { PAYPAL_WEBHOOK_EVENT_TYPES } from "@/lib/paypal/webhooks/events";

const credentials = { clientId: "test-client-id", clientSecret: "test-client-secret" };
const TOKEN_URL = "https://api-m.sandbox.paypal.com/v1/oauth2/token";

type Call = { url: string; init: RequestInit };

function restAnswering(body: unknown, status = 200) {
  const calls: Call[] = [];
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url, init });
    if (url === TOKEN_URL && init.body === "grant_type=client_credentials") {
      return Response.json({ access_token: "app-token", token_type: "Bearer", expires_in: 32_400 });
    }
    return Response.json(body, { status });
  });
  const tokens = createAppTokenSource({ credentials, fetch });
  const rest = createPayPalRestClient({ credentials, tokens, fetch });
  const apiCall = () => calls.filter((call) => call.init.body !== "grant_type=client_credentials").at(-1);
  return { rest, apiCall };
}

const header = (call: Call | undefined, name: string) => new Headers(call?.init.headers).get(name);

const seller: PayoutItemInput = {
  senderItemId: "item_1",
  amountCents: 1_800,
  recipientType: "EMAIL",
  receiver: "roomover-seller1-jin0608@personal.example.com",
  wallet: "PAYPAL",
};

describe("Payouts", () => {
  const created = { batch_header: { payout_batch_id: "5UXD2E8A7EBQJ", batch_status: "PENDING" }, links: [] };

  it("uses the idempotency key as both PayPal-Request-Id and sender_batch_id", async () => {
    const { rest, apiCall } = restAnswering(created, 201);

    const result = await createPayoutBatch(
      rest,
      { emailSubject: "Your Roomover payout", items: [seller] },
      "rmv.payout.settlement-7.1",
    );

    expect(result.batch_header.payout_batch_id).toBe("5UXD2E8A7EBQJ");
    const call = apiCall();
    expect(call?.url).toBe("https://api-m.sandbox.paypal.com/v1/payments/payouts");
    expect(header(call, "PayPal-Request-Id")).toBe("rmv.payout.settlement-7.1");
    expect(JSON.parse(String(call?.init.body))).toEqual({
      sender_batch_header: { sender_batch_id: "rmv.payout.settlement-7.1", email_subject: "Your Roomover payout" },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: "roomover-seller1-jin0608@personal.example.com",
          amount: { currency: "USD", value: "18.00" },
          recipient_wallet: "PAYPAL",
          sender_item_id: "item_1",
        },
      ],
    });
  });

  it("refuses a Venmo item without a note before calling PayPal", async () => {
    const { rest, apiCall } = restAnswering(created, 201);
    const venmo: PayoutItemInput = { ...seller, wallet: "VENMO", recipientType: "USER_HANDLE", receiver: "@seller-five" };

    expect(() => createPayoutBatch(rest, { emailSubject: "Payout", items: [venmo] }, "rmv.payout.s-1.1")).toThrow(
      /needs a note/,
    );
    expect(() => createPayoutBatch(rest, { emailSubject: "Payout", items: [] }, "rmv.payout.s-1.1")).toThrow(RangeError);
    expect(apiCall()).toBeUndefined();
  });

  it("reads a batch with its items", async () => {
    const { rest, apiCall } = restAnswering({
      batch_header: { payout_batch_id: "5UXD2E8A7EBQJ", batch_status: "SUCCESS" },
      items: [
        {
          payout_item_id: "8AELMXH8UB2P8",
          transaction_status: "SUCCESS",
          payout_item: { sender_item_id: "item_1", amount: { currency: "USD", value: "18.00" } },
        },
      ],
    });

    const batch = await getPayoutBatch(rest, "5UXD2E8A7EBQJ");

    expect(batch.items[0].transaction_status).toBe("SUCCESS");
    expect(apiCall()?.url).toBe(
      "https://api-m.sandbox.paypal.com/v1/payments/payouts/5UXD2E8A7EBQJ?page_size=1000&total_required=true",
    );
  });
});

describe("Disputes", () => {
  const evidence = {
    evidenceType: "ITEM_DESCRIPTION" as const,
    notes: "Listing and handoff photos match. No new damage on the desk.",
    files: [{ filename: "handoff-desk.png", contentType: "image/png" as const, data: new Uint8Array([137, 80, 78, 71]) }],
  };

  it("sends the input JSON part and one evidence-file part per document", async () => {
    const { rest, apiCall } = restAnswering({ links: [{ rel: "self", method: "GET", href: "https://x" }] });

    await provideDisputeEvidence(rest, "PP-D-27803", evidence);

    const call = apiCall();
    expect(call?.url).toBe("https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-27803/provide-evidence");
    expect(header(call, "PayPal-Request-Id")).toBeNull();
    const form = call?.init.body as FormData;
    const input = JSON.parse(await (form.get("input") as Blob).text());
    expect(input).toEqual({
      evidences: [{ evidence_type: "ITEM_DESCRIPTION", notes: evidence.notes, documents: [{ name: "handoff-desk.png" }] }],
    });
    expect((form.getAll("evidence-file")[0] as File).name).toBe("handoff-desk.png");
  });

  it("rejects file names, sizes, and notes PayPal would refuse", () => {
    const { rest } = restAnswering({});
    const bigFile = { ...evidence.files[0], data: new Uint8Array(10 * 1024 * 1024) };

    expect(() => provideDisputeEvidence(rest, "PP-D-1", { ...evidence, notes: "" })).toThrow(RangeError);
    expect(() => provideDisputeEvidence(rest, "PP-D-1", { ...evidence, files: [bigFile] })).toThrow(/under 10 MB/);
    expect(() =>
      provideDisputeEvidence(rest, "PP-D-1", { ...evidence, files: [{ ...evidence.files[0], filename: "a/b.png" }] }),
    ).toThrow(RangeError);
  });
});

describe("Log in with PayPal", () => {
  it("builds the authorize URL with a redirect URI from APP_URL", () => {
    const redirectUri = readLoginWithPayPalRedirectUri({ APP_URL: "http://127.0.0.1:3000" });
    const url = new URL(loginWithPayPalUrl({ clientId: "test-client-id", redirectUri, state: "csrf-state" }));

    expect(`${url.origin}${url.pathname}`).toBe("https://www.sandbox.paypal.com/connect");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      flowEntry: "static",
      client_id: "test-client-id",
      response_type: "code",
      scope: "openid email https://uri.paypal.com/services/paypalattributes",
      redirect_uri: "http://127.0.0.1:3000/api/auth/paypal/callback",
      state: "csrf-state",
    });
  });

  it("exchanges the code with Basic auth and accepts expires_in as a string", async () => {
    const { rest, apiCall } = restAnswering({
      access_token: "user-token",
      token_type: "Bearer",
      expires_in: "28800",
      refresh_token: "refresh",
    });

    const token = await exchangeAuthorizationCode(rest, "auth-code");

    expect(token.expires_in).toBe(28_800);
    const call = apiCall();
    expect(header(call, "Authorization")).toMatch(/^Basic /);
    expect(String(call?.init.body)).toBe("grant_type=authorization_code&code=auth-code");
  });

  it("reads userinfo with the user's token, not the app token", async () => {
    const { rest, apiCall } = restAnswering({ user_id: "https://www.paypal.com/webapps/auth/identity/user/abc", payer_id: "G83JXTJ5EHCQ2" });

    const user = await getUserInfo(rest, "user-token");

    expect(user.payer_id).toBe("G83JXTJ5EHCQ2");
    expect(header(apiCall(), "Authorization")).toBe("Bearer user-token");
    expect(apiCall()?.url).toBe("https://api-m.sandbox.paypal.com/v1/identity/oauth2/userinfo?schema=paypalv1.1");
  });
});

describe("Webhook registration", () => {
  it("subscribes to exactly the handled event types", async () => {
    const { rest, apiCall } = restAnswering({ id: "8PT597110X687430LKGECATA", url: "https://roomover.onrender.com/api/paypal/webhooks", event_types: [] }, 201);

    await createWebhook(rest, { url: "https://roomover.onrender.com/api/paypal/webhooks", eventTypes: PAYPAL_WEBHOOK_EVENT_TYPES });

    const body = JSON.parse(String(apiCall()?.init.body));
    expect(body.event_types.map((type: { name: string }) => type.name)).toEqual([...PAYPAL_WEBHOOK_EVENT_TYPES]);
  });
});
