import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { readConfig, readOptionalConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { agentEvents, orderItems, orders, payoutItems, payouts, webhookEvents } from "@/lib/db/schema";
import { paypalRest } from "@/lib/paypal/rest/client";
import { newSessionId, SESSION_COOKIE, signSession } from "@/lib/session";
import { createDemoPlan } from "./demo-plan";

/**
 * One real handoff in the sandbox, recorded on video, against a server
 * running without fixtures, so the verifier calls Claude live. The judge
 * buyer approves the five seller demo cart, the student checks every item
 * with its sample photo (the chair with its new tear), confirms each one,
 * and the run waits until every seller's payout lands. It prints every
 * PayPal ID, the platform balance before and after, the timings, the
 * verifier's Claude usage, and the webhook events Postgres stored.
 *
 *   pnpm handoff:run --base http://127.0.0.1:3000 --out <folder>
 */

const args = new Map(process.argv.slice(2).flatMap((value, index, all) => (value.startsWith("--") ? [[value.slice(2), all[index + 1]]] : [])));
const BASE = args.get("base") ?? "http://127.0.0.1:3000";
const OUT = args.get("out") ?? "test-results/handoff-run";
const JUDGE_BUYER = "roomover-judge-jin0608@personal.example.com";
const GPU = process.platform === "darwin" ? ["--use-angle=metal", "--ignore-gpu-blocklist"] : ["--ignore-gpu-blocklist"];
const WEBHOOK_WAIT_MS = 240_000;
const CART: readonly { sample: "Use a sample photo" | "Sample with a new tear"; confirm: string }[] = [
  { sample: "Use a sample photo", confirm: "Confirm, pay $55" },
  { sample: "Sample with a new tear", confirm: "Confirm, pay $30" },
  { sample: "Use a sample photo", confirm: "Confirm, pay $16" },
  { sample: "Use a sample photo", confirm: "Confirm, pay $8" },
  { sample: "Use a sample photo", confirm: "Confirm, pay $30" },
];

const moneySchema = z.object({ currency_code: z.string(), value: z.string() });
const balancesSchema = z.object({
  balances: z.array(z.object({ currency: z.string(), primary: z.boolean().optional(), total_balance: moneySchema, available_balance: moneySchema.optional(), withheld_balance: moneySchema.optional() })).default([]),
  as_of_time: z.string().optional(),
  last_refresh_time: z.string().optional(),
});

/** The platform account's USD balance from the Transaction Search balances endpoint, which can trail by a few hours. */
async function platformBalance() {
  try {
    const answer = await paypalRest().request({ method: "GET", path: "/v1/reporting/balances", query: { currency_code: "USD" }, schema: balancesSchema });
    const usd = answer.balances.find((balance) => balance.currency === "USD");
    return { total: usd?.total_balance.value ?? null, available: usd?.available_balance?.value ?? null, asOf: answer.as_of_time ?? null, lastRefresh: answer.last_refresh_time ?? null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "unknown" };
  }
}

const seconds = (ms: number) => Number((ms / 1000).toFixed(1));

async function approve(page: Page, password: string) {
  const popupOpened = page.waitForEvent("popup");
  await page.locator("paypal-button").click();
  const popup = await popupOpened;
  await popup.waitForLoadState("domcontentloaded");
  const email = popup.locator("input#email, input[name=login_email]");
  await email.waitFor({ timeout: 45_000 });
  await email.fill(JUDGE_BUYER);
  const next = popup.locator("#btnNext");
  if (await next.isVisible()) await next.click();
  const field = popup.locator("input#password, input[name=login_password]");
  await field.waitFor({ timeout: 30_000 });
  await field.fill(password);
  await popup.locator("#btnLogin").click();
  const complete = popup.getByTestId("submit-button-initial");
  await complete.waitFor({ timeout: 60_000 });
  await complete.click();
}

async function main() {
  const password = readOptionalConfig("PAYPAL_SANDBOX_BUYER_PASSWORD");
  if (password === undefined) throw new Error("Set PAYPAL_SANDBOX_BUYER_PASSWORD in .env.local.");
  await mkdir(OUT, { recursive: true });
  const db = getDb();
  const sessionId = newSessionId();
  const planId = await createDemoPlan(db, sessionId);
  const before = await platformBalance();

  const browser = await chromium.launch({ args: GPU });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } });
  await context.addCookies([{ name: SESSION_COOKIE, value: signSession(sessionId, readConfig(["SESSION_SECRET"]).SESSION_SECRET), url: BASE, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const timings: Record<string, number | number[]> = {};
  const started = Date.now();

  await page.goto(`${BASE}/furnish`);
  await page.locator('[data-paypal-checkout="ready"]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const pressed = Date.now();
  await approve(page, password);
  await page.getByText("PayPal holds your $144 until handoff").waitFor({ timeout: 90_000 });
  timings.approvalSeconds = seconds(Date.now() - pressed);
  await page.waitForTimeout(2000);
  await page.getByRole("link", { name: "Go to handoff" }).click();
  await page.getByRole("heading", { level: 1, name: "Handoff" }).waitFor();
  await page.waitForTimeout(2500);

  const comparisons: number[] = [];
  for (const step of CART) {
    const tapped = Date.now();
    await page.getByRole("button", { name: step.sample }).click();
    await page.getByRole("button", { name: step.confirm }).waitFor({ timeout: 60_000 });
    comparisons.push(seconds(Date.now() - tapped));
    await page.waitForTimeout(step.sample === "Sample with a new tear" ? 4000 : 1800);
    await page.getByRole("button", { name: step.confirm }).click();
    await page.waitForTimeout(900);
  }
  timings.comparisonSeconds = comparisons;
  const confirmedLast = Date.now();
  await page.getByRole("heading", { level: 1, name: "Handoff done" }).waitFor({ timeout: 120_000 });
  timings.settleSeconds = seconds(Date.now() - confirmedLast);
  await page.locator('li[data-paid="true"]').nth(4).waitFor({ timeout: 300_000 });
  timings.lastConfirmToAllPaidSeconds = seconds(Date.now() - confirmedLast);
  await page.waitForTimeout(2500);
  await page.getByRole("switch", { name: "Under the hood" }).click();
  await page.locator('[data-paypal-moment="paid"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(4000);
  timings.totalSeconds = seconds(Date.now() - started);
  const video = page.video();
  await context.close();
  await browser.close();
  if (video !== null) await rename(await video.path(), join(OUT, "run.webm"));

  const [order] = await db.select().from(orders).where(eq(orders.planId, planId));
  const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  const [payout] = await db.select().from(payouts).where(eq(payouts.orderId, order.id));
  const paid = await db.select().from(payoutItems).where(eq(payoutItems.payoutId, payout.id));
  const usage = await db
    .select({ calls: sql<number>`coalesce(sum((${agentEvents.detail}->>'claudeCalls')::int), 0)::int`, input: sql<number>`coalesce(sum((${agentEvents.detail}->>'inputTokens')::int), 0)::int`, output: sql<number>`coalesce(sum((${agentEvents.detail}->>'outputTokens')::int), 0)::int` })
    .from(agentEvents)
    .where(and(eq(agentEvents.orderId, order.id), eq(agentEvents.agent, "verifier")));

  // PayPal sends the webhooks to the deployed app, which shares this database. Wait until each resource has its events.
  const resourceIds = [order.paypalAuthorizationId, ...lines.map((line) => line.paypalCaptureId), payout.paypalBatchId, ...paid.map((item) => item.paypalPayoutItemId)].filter((id): id is string => id !== null);
  let stored: (typeof webhookEvents.$inferSelect)[] = [];
  for (const waitStarted = Date.now(); Date.now() - waitStarted < WEBHOOK_WAIT_MS; await new Promise((resolve) => setTimeout(resolve, 10_000))) {
    stored = await db.select().from(webhookEvents).where(inArray(webhookEvents.resourceId, resourceIds));
    const types = new Set(stored.map((event) => event.eventType));
    if (stored.filter((event) => event.eventType === "PAYMENT.CAPTURE.COMPLETED").length >= lines.length && types.has("PAYMENT.PAYOUTSBATCH.SUCCESS") && stored.filter((event) => event.eventType === "PAYMENT.PAYOUTS-ITEM.SUCCEEDED").length >= paid.length) break;
  }
  const duplicates = stored.length - new Set(stored.map((event) => event.paypalEventId)).size;
  const after = await platformBalance();

  console.log(
    JSON.stringify(
      {
        planId,
        order: { id: order.id, paypalOrderId: order.paypalOrderId, authorizationId: order.paypalAuthorizationId, status: order.status, totalCents: order.totalCents, voided: order.voidedAt !== null },
        captures: lines.map((line) => ({ captureId: line.paypalCaptureId, capturedCents: line.capturedAmountCents, amountCents: line.amountCents, status: line.status })),
        payout: { paypalBatchId: payout.paypalBatchId, senderBatchId: payout.senderBatchId, status: payout.status, totalCents: payout.totalCents, items: paid.map((item) => ({ receiver: item.receiver, amountCents: item.amountCents, paypalPayoutItemId: item.paypalPayoutItemId, status: item.status })) },
        claude: usage[0],
        timings,
        platformBalance: { before, after },
        webhooks: { stored: stored.map((event) => [event.eventType, event.paypalEventId, event.resourceId]), duplicates },
        consoleErrors: errors,
      },
      null,
      1,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 500));
