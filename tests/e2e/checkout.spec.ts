import AxeBuilder from "@axe-core/playwright";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { readOptionalConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { latestSessionPlan } from "@/lib/db/plans";
import { listings, orderItems, orders, webhookEvents } from "@/lib/db/schema";
import { expect, test } from "./support/session";

/**
 * One real sandbox checkout. The buyer agent replays its recorded plan, the
 * official PayPal button opens the sandbox popup, the judge buyer approves,
 * and the server authorizes the order. Teardown voids the authorization and
 * puts the listings back on sale. PayPal sends the webhooks to the deployed
 * app, which shares this database.
 */

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? "test-results/screenshots";
const JUDGE_BUYER = "roomover-judge-jin0608@personal.example.com";
const WEBHOOK_WAIT_MS = 120_000;
const BUYER_PASSWORD = readOptionalConfig("PAYPAL_SANDBOX_BUYER_PASSWORD");

async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const blocking = axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
}

async function approveInPopup(popup: Page) {
  await popup.waitForLoadState("domcontentloaded");
  const email = popup.locator("input#email, input[name=login_email]");
  await email.waitFor({ timeout: 45_000 });
  await email.fill(JUDGE_BUYER);
  const next = popup.locator("#btnNext");
  if (await next.isVisible()) await next.click();
  const password = popup.locator("input#password, input[name=login_password]");
  await password.waitFor({ timeout: 30_000 });
  await password.fill(BUYER_PASSWORD ?? "");
  await popup.locator("#btnLogin").click();
  const complete = popup.getByTestId("submit-button-initial");
  await complete.waitFor({ timeout: 60_000 });
  await popup.waitForTimeout(1500);
  await popup.screenshot({ path: `${SCREENSHOT_DIR}/checkout-popup-1440.png` });
  await complete.click();
}

test("the student approves one PayPal checkout and PayPal holds the money for every seller", async ({ page, session }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "The real sandbox checkout runs once, on desktop.");
  test.skip(BUYER_PASSWORD === undefined, "Needs PAYPAL_SANDBOX_BUYER_PASSWORD in .env.local.");
  test.setTimeout(300_000);
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

  await page.goto("/furnish");
  await page.getByLabel("What should your room feel like?").fill("$150, cozy, I study late");
  await page.getByRole("button", { name: "Plan my room" }).click();
  await expect(page.locator("ul[aria-live] [data-sentence]").last()).toHaveText("Your room is ready. 5 items from 4 students.", { timeout: 60_000 });

  // The official button, the Pay Later button, and the Pay Later message for the plan total.
  await expect(page.locator('[data-paypal-checkout="ready"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("paypal-button")).toBeVisible();
  await expect(page.locator("paypal-pay-later-button")).toBeVisible();
  await expect(page.getByText(/Pay in 4 interest-free payments of \$25\.00/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-total]")).toHaveText("$100");
  await expectAccessible(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/checkout-ready-1440.png`, fullPage: true, scale: "css" });

  // Closing the popup before approving charges nothing and says how to go on.
  const firstPopup = page.waitForEvent("popup");
  await page.locator("paypal-button").click();
  const closing = await firstPopup;
  await closing.locator("input#email, input[name=login_email]").waitFor({ timeout: 45_000 });
  await closing.close();
  await expect(page.getByText("You closed PayPal before approving, so nothing was charged. Press PayPal when you are ready.")).toBeVisible({ timeout: 30_000 });

  const popupOpened = page.waitForEvent("popup");
  await page.locator("paypal-button").click();
  await approveInPopup(await popupOpened);

  // The panel turns to the held state, and Under the hood names the API and both IDs.
  await expect(page.getByText("PayPal holds your $100 until handoff")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Each item is charged when you check it at handoff, and 4 students get paid then.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: /^Handoff$/ })).toHaveAttribute("aria-current", "step");
  await expect(page.locator("paypal-button")).toHaveCount(0);
  await page.getByRole("switch", { name: "Under the hood" }).click();
  const card = page.locator('[data-paypal-moment="held"]');
  await expect(card.getByText("Orders v2").first()).toBeVisible();

  const db = getDb();
  const plan = await latestSessionPlan(db, session);
  if (plan === null) throw new Error("The session has no plan.");
  const [order] = await db.select().from(orders).where(and(eq(orders.planId, plan.id), eq(orders.status, "authorized")));
  expect(order).toBeDefined();
  expect(order.paymentMode).toBe("authorize_then_capture");
  expect(order.paypalOrderId).toMatch(/^[A-Z0-9]{17}$/);
  expect(order.paypalAuthorizationId).toMatch(/^[A-Z0-9]{17}$/);
  await expect(card.getByText(order.paypalOrderId ?? "")).toBeVisible();
  await expect(card.getByText(order.paypalAuthorizationId ?? "")).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/checkout-held-1440.png`, fullPage: true, scale: "css" });

  // The order rows match the plan with one line per listing at its listed price, and the listings are reserved.
  const planListingIds = plan.layout.items.flatMap((item) => (item.source === "listing" ? [item.listingId] : []));
  const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.listingId));
  const listed = await db.select().from(listings).where(inArray(listings.id, planListingIds)).orderBy(asc(listings.id));
  expect(lines.map((line) => [line.listingId, line.sellerId, line.amountCents, line.status])).toEqual(listed.map((listing) => [listing.id, listing.sellerId, listing.priceCents, "authorized"]));
  expect(order.totalCents).toBe(listed.reduce((sum, listing) => sum + listing.priceCents, 0));
  expect(listed.every((listing) => listing.status === "reserved")).toBe(true);

  // PayPal delivers PAYMENT.AUTHORIZATION.CREATED to the deployed route, which stores it once.
  let stored: (typeof webhookEvents.$inferSelect)[] = [];
  for (const started = Date.now(); Date.now() - started < WEBHOOK_WAIT_MS && stored.length === 0; await page.waitForTimeout(3000)) {
    stored = await db.select().from(webhookEvents).where(eq(webhookEvents.resourceId, order.paypalAuthorizationId ?? ""));
  }
  expect(stored.map((event) => event.eventType)).toEqual(["PAYMENT.AUTHORIZATION.CREATED"]);
  testInfo.annotations.push(
    { type: "paypal-order", description: order.paypalOrderId ?? "" },
    { type: "paypal-authorization", description: order.paypalAuthorizationId ?? "" },
    { type: "webhook-events", description: stored.map((event) => `${event.eventType} ${event.paypalEventId}`).join(", ") },
  );
  console.log(JSON.stringify({ order: order.paypalOrderId, authorization: order.paypalAuthorizationId, totalCents: order.totalCents, webhooks: stored.map((event) => [event.eventType, event.paypalEventId, event.receivedAt]) }));

  await page.getByRole("link", { name: "Go to handoff" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Handoff opens next" })).toBeVisible();
  expect(problems).toEqual([]);
});
