/**
 * Sandbox smoke test for the PayPal layer. Creates one AUTHORIZE order for a
 * small cart, then reads it back through the Server SDK and through the Agent
 * Toolkit read tool. Prints IDs and statuses only, never credentials or tokens.
 *
 *   pnpm paypal:smoke
 */
import { z } from "zod";
import { createPayPalReadTools } from "@/lib/agents/tools/paypal-read";
import { readConfig } from "@/lib/config";
import { PayPalApiError } from "@/lib/paypal/errors";
import { orderCreateKey } from "@/lib/paypal/idempotency";
import { appTokens } from "@/lib/paypal/rest/app-token";
import { paypalSdk } from "@/lib/paypal/server-sdk/client";
import { approvalLink, createOrder, getOrder, type CreateOrderInput } from "@/lib/paypal/server-sdk/orders";

const toolOrderSchema = z.object({ id: z.string(), status: z.string() });

function line(label: string, value: string): void {
  console.log(`${label.padEnd(26)}${value}`);
}

async function main(): Promise<void> {
  const { APP_URL } = readConfig(["APP_URL"]);
  const sdk = paypalSdk();

  const token = await appTokens().get();
  line("App token", `ok, refresh in ${Math.round((token.refreshAt - Date.now()) / 60_000)} min`);

  const smokeId = `smoke-${Date.now()}`;
  const cart: CreateOrderInput = {
    intent: "AUTHORIZE",
    referenceId: smokeId,
    returnUrl: new URL("/checkout/return", APP_URL).toString(),
    cancelUrl: new URL("/checkout/cancel", APP_URL).toString(),
    items: [
      { name: "Oak desk lamp", unitAmountCents: 1_800, quantity: 1, sku: "smoke-lamp" },
      { name: "Three shelf bookcase", unitAmountCents: 3_550, quantity: 1, sku: "smoke-bookcase" },
      { name: "Fabric storage bin", unitAmountCents: 650, quantity: 2, sku: "smoke-bin" },
    ],
  };
  const key = orderCreateKey(smokeId, 1);

  const created = await createOrder(sdk, cart, key);
  if (created.id === undefined) throw new Error("PayPal created an order without an ID.");
  line("PayPal-Request-Id", key);
  line("Created order", `${created.id} (${created.status ?? "no status"})`);

  const replay = await createOrder(sdk, cart, key);
  line("Same key again", replay.id === created.id ? `replayed ${replay.id}` : `NEW ORDER ${replay.id ?? "?"}`);
  if (replay.id !== created.id) throw new Error("PayPal-Request-Id did not deduplicate order creation.");

  const fetched = await getOrder(sdk, created.id);
  const unit = fetched.purchaseUnits?.[0];
  line("Server SDK get order", `${fetched.id} ${fetched.status} ${unit?.amount?.value} ${unit?.amount?.currencyCode}`);
  line("Items", String(unit?.items?.length ?? 0));

  const getOrderTool = createPayPalReadTools().find((tool) => tool.name === "get_order");
  if (getOrderTool === undefined) throw new Error("get_order is missing from the read tools.");
  const toolResult = await getOrderTool.run({ id: created.id });
  if (typeof toolResult !== "string") throw new Error("get_order returned content blocks, expected JSON text.");
  const toolOrder = toolOrderSchema.parse(JSON.parse(toolResult));
  line("Agent Toolkit get_order", `${toolOrder.id} ${toolOrder.status}`);

  line("Approval link", approvalLink(fetched) ?? approvalLink(created) ?? "none");
}

main().catch((error: unknown) => {
  if (error instanceof PayPalApiError) {
    console.error(
      `PayPal error on ${error.operation}: ${error.status} ${error.errorName}. ${error.message} (debug ID ${error.debugId ?? "none"})`,
    );
    for (const detail of error.details) console.error(`  ${detail.issue}: ${detail.description ?? ""}`);
  } else {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : "Unknown failure");
  }
  process.exitCode = 1;
});
