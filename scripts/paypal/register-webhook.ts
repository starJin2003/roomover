/**
 * Points the sandbox app's webhook at a deployed Roomover host with every
 * subscribed event type. A later run finds the webhook for that URL and
 * updates its event list, so the app keeps one webhook per URL. Prints
 * only the last four characters of the webhook ID.
 *
 *   pnpm paypal:webhook https://<render-host> [--update-env-local]
 *
 * --update-env-local replaces the PAYPAL_WEBHOOK_ID line in .env.local and
 * touches nothing else in that file.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { paypalRest } from "@/lib/paypal/rest/client";
import { ensureWebhook } from "@/lib/paypal/rest/webhooks";
import { PAYPAL_WEBHOOK_EVENT_TYPES } from "@/lib/paypal/webhooks/events";
import { reportScriptError } from "./report-error";

const WEBHOOK_PATH = "/api/paypal/webhooks";
const ENV_LOCAL = path.join(process.cwd(), ".env.local");
const WEBHOOK_ID_LINE = /^PAYPAL_WEBHOOK_ID=.*$/m;

const argsSchema = z.tuple([z.url({ protocol: /^https$/, error: "Pass the deployed https base URL." })]).rest(z.literal("--update-env-local"));

function writeWebhookIdToEnvLocal(webhookId: string): void {
  const current = readFileSync(ENV_LOCAL, "utf8");
  if (current.match(new RegExp(WEBHOOK_ID_LINE.source, "gm"))?.length !== 1) {
    throw new Error(".env.local must contain exactly one PAYPAL_WEBHOOK_ID line.");
  }
  writeFileSync(ENV_LOCAL, current.replace(WEBHOOK_ID_LINE, `PAYPAL_WEBHOOK_ID=${webhookId}`));
}

async function main(): Promise<void> {
  const [baseUrl, ...flags] = argsSchema.parse(process.argv.slice(2));
  const url = new URL(WEBHOOK_PATH, baseUrl).toString();

  const { action, webhook } = await ensureWebhook(paypalRest(), { url, eventTypes: PAYPAL_WEBHOOK_EVENT_TYPES });
  console.log(`Webhook ${action}: ID ending ${webhook.id.slice(-4)}, ${webhook.event_types.length} event types, ${webhook.url}`);

  if (flags.includes("--update-env-local")) {
    writeWebhookIdToEnvLocal(webhook.id);
    console.log("Replaced the PAYPAL_WEBHOOK_ID line in .env.local.");
  }
}

main().catch(reportScriptError);
