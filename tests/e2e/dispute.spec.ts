import { randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { and, eq } from "drizzle-orm";
import type { APIRequestContext, Page } from "@playwright/test";
import { getDb } from "@/lib/db/client";
import { agentEvents, disputes, orderItems, orders } from "@/lib/db/schema";
import { createDemoPlan } from "@/scripts/handoff/demo-plan";
import { HARBOR_214_DEMO_LAYOUT } from "@/scripts/seed/layouts";
import { payDemoCart, payDemoCartAtDesktop } from "./support/demo-checkout";
import { captureFullHeight, expectFitsDesktops } from "./support/layout";
import { LIVE } from "./support/sandbox";
import { expect, test } from "./support/session";

test.use({ holdsCatalog: true });

/**
 * A dispute on a settled plan. After the five seller handoff pays out, the
 * buyer opens a "not as described" dispute on the chair in PayPal, which
 * reaches Roomover as a CUSTOMER.DISPUTE.CREATED webhook. The recorded
 * sandbox verifies the webhook and answers the verifier's toolkit reads, the
 * verifier replays the note it wrote in the real sandbox run, and Roomover
 * sends the evidence. The Handoff screen then states the dispute in plain
 * words, and a resolution in the seller's favor closes it.
 */

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? "test-results/screenshots";
const CHAIR = HARBOR_214_DEMO_LAYOUT.items.find((item) => item.key === "marcus-mesh-desk-chair");
const CHAIR_LISTING = CHAIR?.source === "listing" ? CHAIR.listingId : "";
const REASON = "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED";

async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const blocking = axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
}

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

async function checkWithSample(page: Page, sample: "Use a sample photo" | "Sample with a new tear", finding: string, confirm: string) {
  await page.getByRole("button", { name: sample }).click();
  await expect(page.locator("[data-finding]")).toHaveText(finding, { timeout: 30_000 });
  await page.getByRole("button", { name: confirm }).click();
}

/** A dispute webhook as PayPal sends it, with transmission headers the recorded sandbox accepts. */
async function sendDisputeEvent(request: APIRequestContext, type: string, resource: Record<string, unknown>, id = `WH-E2E-${randomBytes(8).toString("hex").toUpperCase()}`) {
  const response = await request.post("/api/paypal/webhooks", {
    headers: {
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77",
      "paypal-transmission-id": randomBytes(16).toString("hex"),
      "paypal-transmission-sig": randomBytes(32).toString("base64"),
      "paypal-transmission-time": new Date().toISOString(),
      "content-type": "application/json",
    },
    data: JSON.stringify({ id, event_type: type, create_time: new Date().toISOString(), resource_type: "dispute", resource }),
  });
  return { id, status: response.status(), body: (await response.json()) as { duplicate?: boolean } };
}

async function evidenceState(disputeId: string): Promise<string | undefined> {
  const [row] = await getDb().select({ state: disputes.evidenceState }).from(disputes).where(eq(disputes.paypalDisputeId, disputeId));
  return row?.state;
}

test("a dispute on a settled plan gets Roomover's evidence, and the student sees it in plain words", async ({ page, session, browser, baseURL }, testInfo) => {
  test.skip(LIVE, "PayPal sends dispute webhooks to the deployed app only. The real sandbox dispute runs through pnpm paypal:dispute.");
  test.setTimeout(420_000);
  const desktop = testInfo.project.name === "desktop-1440";
  const width = desktop ? 1440 : 390;
  const problems = watchConsole(page);
  const planId = await createDemoPlan(getDb(), session);
  if (desktop) await payDemoCart(page);
  else await payDemoCartAtDesktop(browser, baseURL ?? "", session);

  // The handoff, with the torn chair kept at $30.
  await page.goto(`/handoff/${planId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Handoff" })).toBeVisible();
  await checkWithSample(page, "Use a sample photo", "Jun's desk matches the listing.", "Confirm, pay $55");
  await checkWithSample(page, "Sample with a new tear", "Marcus's chair has a new 3 cm tear. You pay $30 of $35.", "Confirm, pay $30");
  await checkWithSample(page, "Use a sample photo", "Ava's lamp matches the listing.", "Confirm, pay $16");
  await checkWithSample(page, "Use a sample photo", "Sofia's clamp lamp matches the listing.", "Confirm, pay $8");
  await checkWithSample(page, "Use a sample photo", "Lea's bean bag matches the listing.", "Confirm, pay $30");
  await expect(page.getByRole("heading", { level: 1, name: "Handoff done" })).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('li[data-paid="true"]')).toHaveCount(5, { timeout: 240_000 });

  // One quiet line points to PayPal, where disputes open.
  const help = page.locator("[data-dispute-help]");
  await expect(help).toHaveText("Problem with an item? Disputes open in PayPal's Resolution Center, opens in a new tab, and Roomover answers with the photos and the handoff record.");
  await expect(help.getByRole("link")).toHaveAttribute("href", "https://www.sandbox.paypal.com/resolutioncenter");
  await expect(page.locator("[data-dispute]")).toHaveCount(0);
  await help.scrollIntoViewIfNeeded();
  await captureFullHeight(page, `${SCREENSHOT_DIR}/dispute-quiet-line-${width}.png`);

  // The buyer opens a dispute about the chair in PayPal, which reaches Roomover as a webhook.
  const [order] = await getDb().select({ id: orders.id }).from(orders).where(eq(orders.planId, planId));
  const [chair] = await getDb().select({ captureId: orderItems.paypalCaptureId }).from(orderItems).where(and(eq(orderItems.orderId, order.id), eq(orderItems.listingId, CHAIR_LISTING)));
  expect(chair?.captureId).toBeTruthy();
  const disputeId = `PP-R-E2E-${randomBytes(4).toString("hex").toUpperCase()}`;
  const opened = new Date();
  const resource = {
    dispute_id: disputeId,
    create_time: opened.toISOString(),
    update_time: opened.toISOString(),
    disputed_transactions: [{ seller_transaction_id: chair?.captureId, items: [{ item_id: CHAIR_LISTING, item_name: "Mesh back rolling desk chair" }] }],
    reason: REASON,
    status: "WAITING_FOR_SELLER_RESPONSE",
    dispute_amount: { currency_code: "USD", value: "30.00" },
    dispute_life_cycle_stage: "CHARGEBACK",
    seller_response_due_date: new Date(opened.getTime() + 10 * 86_400_000).toISOString(),
  };
  const created = await sendDisputeEvent(page.request, "CUSTOMER.DISPUTE.CREATED", resource);
  expect(created).toMatchObject({ status: 200, body: { duplicate: false } });
  await expect.poll(() => evidenceState(disputeId), { timeout: 60_000 }).toBe("sent");

  // A redelivery of the same event changes nothing and sends nothing again.
  expect(await sendDisputeEvent(page.request, "CUSTOMER.DISPUTE.CREATED", resource, created.id)).toMatchObject({ status: 200, body: { duplicate: true } });

  await page.reload();
  const card = page.locator(`[data-dispute="${disputeId}"]`);
  await expect(card).toContainText("Jordan opened a dispute about the chair.");
  await expect(card).toContainText("Roomover sent PayPal the photos and the handoff record.");
  await expect(page.locator("li[data-paid]").filter({ hasText: "Marcus Bell" }).locator("[data-seller-dispute]")).toHaveText("Dispute open");
  await card.scrollIntoViewIfNeeded();
  await expectAccessible(page);
  await captureFullHeight(page, `${SCREENSHOT_DIR}/dispute-card-${width}.png`);

  // Under the hood names the dispute, each Agent Toolkit read, and the evidence Roomover sent.
  await page.getByRole("switch", { name: "Under the hood" }).click();
  await expect(card.locator("[data-dispute-details]")).toContainText(`Dispute ${disputeId}, ${REASON}, CHARGEBACK, sandbox`);
  const reads = card.locator("[data-toolkit-read]");
  await expect(reads).toHaveCount(4);
  await expect(reads.locator("code")).toHaveText(["get_dispute", "get_dispute", "get_order", "list_transactions"]);
  await expect(card.locator("[data-evidence-submission]")).toContainText("ITEM_DESCRIPTION, 3 files");
  await card.scrollIntoViewIfNeeded();
  await expectAccessible(page);
  await captureFullHeight(page, `${SCREENSHOT_DIR}/dispute-under-the-hood-${width}.png`);

  const submissions = await getDb().select({ id: agentEvents.id }).from(agentEvents).where(and(eq(agentEvents.orderId, order.id), eq(agentEvents.tool, "provide_evidence")));
  expect(submissions).toHaveLength(1);

  // PayPal decides for the seller. An older update that arrives after the decision changes nothing.
  const resolved = new Date(opened.getTime() + 60_000);
  expect(await sendDisputeEvent(page.request, "CUSTOMER.DISPUTE.RESOLVED", { ...resource, status: "RESOLVED", update_time: resolved.toISOString(), dispute_outcome: { outcome_code: "RESOLVED_SELLER_FAVOUR" } })).toMatchObject({ status: 200 });
  expect(await sendDisputeEvent(page.request, "CUSTOMER.DISPUTE.UPDATED", { ...resource, status: "UNDER_REVIEW", update_time: new Date(opened.getTime() + 30_000).toISOString() })).toMatchObject({ status: 200 });
  await page.reload();
  await page.getByRole("switch", { name: "Under the hood" }).click();
  await expect(card).toContainText("PayPal closed the dispute about the chair in Marcus's favor.");
  await expect(card).toHaveAttribute("data-dispute-status", "resolved");
  await expect(page.locator("li[data-paid]").filter({ hasText: "Marcus Bell" }).locator("[data-seller-dispute]")).toHaveText("Dispute closed");
  await card.scrollIntoViewIfNeeded();
  await captureFullHeight(page, `${SCREENSHOT_DIR}/dispute-resolved-${width}.png`);
  if (desktop) await expectFitsDesktops(page, SCREENSHOT_DIR, "dispute");
  expect(problems).toEqual([]);
});
