import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recordFromOrder } from "@/lib/checkout/approve";
import { createPayPalRestClient } from "@/lib/paypal/rest/client";
import { createAppTokenSource } from "@/lib/paypal/rest/app-token";
import { exchangeAuthorizationCode, getUserInfo, payerIdOf } from "@/lib/paypal/rest/identity";
import { createPayoutBatch, getPayoutBatch } from "@/lib/paypal/rest/payouts";
import { createPayPalSdk } from "@/lib/paypal/server-sdk/client";
import { authorizeOrder, captureOrder, createOrder } from "@/lib/paypal/server-sdk/orders";
import { captureAuthorization, refundCapture, voidAuthorization } from "@/lib/paypal/server-sdk/payments";
import { createSimulatedSandbox, sandboxRecordingSchema, simulatedAdapter, simulatedFetch } from "@/lib/paypal/simulated-sandbox";

const credentials = { clientId: "client", clientSecret: "secret" };

function clients() {
  const sandbox = createSimulatedSandbox(sandboxRecordingSchema.parse(JSON.parse(readFileSync("tests/fixtures/paypal-sandbox.json", "utf8"))).templates);
  const fetch = simulatedFetch(sandbox);
  const tokens = createAppTokenSource({ credentials, fetch });
  return {
    sdk: createPayPalSdk({ credentials, tokens, transportOverrides: { adapter: simulatedAdapter(sandbox) } }),
    rest: createPayPalRestClient({ credentials, tokens, fetch }),
  };
}

const cart = {
  intent: "AUTHORIZE" as const,
  referenceId: "order-1",
  items: [
    { name: "White three drawer desk", unitAmountCents: 5500, quantity: 1 },
    { name: "Mesh back rolling desk chair", unitAmountCents: 3500, quantity: 1 },
  ],
  returnUrl: "https://example.com/return",
  cancelUrl: "https://example.com/cancel",
};

describe("simulated PayPal sandbox", () => {
  it("authorizes, captures each item, and pays sellers through the real SDK and REST parsers", async () => {
    const { sdk, rest } = clients();
    const order = await createOrder(sdk, cart, "rmv.order-create.order-1.1");
    expect(order.status).toBe("PAYER_ACTION_REQUIRED");
    expect(order.links?.some((link) => link.rel === "payer-action")).toBe(true);

    const authorized = recordFromOrder(await authorizeOrder(sdk, order.id ?? "", "rmv.order-authorize.order-1.1"), new Date());
    expect(authorized.status).toBe("authorized");
    const authorizationId = authorized.authorizationId ?? "";

    const first = await captureAuthorization(sdk, authorizationId, { amountCents: 5500, finalCapture: false }, "rmv.capture.item-1.1");
    const second = await captureAuthorization(sdk, authorizationId, { amountCents: 3000, finalCapture: true }, "rmv.capture.item-2.1");
    expect([first.status, first.amount?.value, second.amount?.value, second.finalCapture]).toEqual(["COMPLETED", "55.00", "30.00", true]);
    // The same key returns PayPal's first answer, like a retried request.
    expect((await captureAuthorization(sdk, authorizationId, { amountCents: 5500, finalCapture: false }, "rmv.capture.item-1.1")).id).toBe(first.id);

    const batch = await createPayoutBatch(rest, { emailSubject: "Paid", items: [{ senderItemId: "item-a", amountCents: 5500, recipientType: "PAYPAL_ID", receiver: "ABCDEFGHJKLMN", wallet: "PAYPAL" }] }, "rmv.payout.order-1.1");
    expect(batch.batch_header.batch_status).toBe("PENDING");
    const processing = await getPayoutBatch(rest, batch.batch_header.payout_batch_id);
    const paid = await getPayoutBatch(rest, batch.batch_header.payout_batch_id);
    expect([processing.batch_header.batch_status, paid.batch_header.batch_status, paid.items[0].transaction_status, paid.items[0].payout_item.sender_item_id]).toEqual(["PROCESSING", "SUCCESS", "SUCCESS", "item-a"]);
  });

  it("voids an open authorization and refunds a capture", async () => {
    const { sdk } = clients();
    const order = await createOrder(sdk, cart, "rmv.order-create.order-2.1");
    const authorized = recordFromOrder(await authorizeOrder(sdk, order.id ?? "", "rmv.order-authorize.order-2.1"), new Date());
    const authorizationId = authorized.authorizationId ?? "";
    expect((await voidAuthorization(sdk, authorizationId, "rmv.void.order-2.1"))?.status).toBe("VOIDED");

    const capturing = await createOrder(sdk, { ...cart, intent: "CAPTURE", referenceId: "order-3" }, "rmv.order-create.order-3.1");
    await expect(authorizeOrder(sdk, capturing.id ?? "", "rmv.order-authorize.order-3.1")).rejects.toMatchObject({ status: 422 });
  });

  it("answers a stubbed Log in with PayPal code with userinfo shaped like the sandbox's, which names no payer ID", async () => {
    const { rest } = clients();
    const token = await exchangeAuthorizationCode(rest, "stub-code");
    const user = await getUserInfo(rest, token.access_token);
    expect(Object.keys(user).sort()).toEqual(["emails", "name", "sub", "user_id"]);
    expect(payerIdOf(user)).toBeNull();
    await expect(exchangeAuthorizationCode(rest, "real-looking-code")).rejects.toMatchObject({ status: 400 });
  });

  it("refunds part of a capture taken at checkout", async () => {
    const { sdk } = clients();
    const order = await createOrder(sdk, { ...cart, intent: "CAPTURE", referenceId: "order-4" }, "rmv.order-create.order-4.1");
    const captured = recordFromOrder(await captureOrder(sdk, order.id ?? "", "rmv.order-capture.order-4.1"), new Date());
    expect(captured.status).toBe("captured");
    const captureId = captured.captureId ?? "";
    const refund = await refundCapture(sdk, captureId, { amountCents: 500 }, "rmv.refund.item-4.1");
    expect([refund.status, refund.amount?.value]).toEqual(["COMPLETED", "5.00"]);
  });
});
