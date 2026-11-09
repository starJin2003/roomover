import AxeBuilder from "@axe-core/playwright";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { getDb } from "@/lib/db/client";
import { latestSessionPlan } from "@/lib/db/plans";
import { listings, orderItems, orders, webhookEvents } from "@/lib/db/schema";
import { expectNoPageScroll } from "./support/layout";
import { approveInPopup, BUYER_PASSWORD } from "./support/paypal-popup";
import { LIVE } from "./support/sandbox";
import { expect, test } from "./support/session";

test.use({ holdsCatalog: true });

/**
 * One checkout. The buyer agent replays its recorded plan, and pressing the
 * PayPal button approves the order, which the server authorizes. By default
 * PayPal answers from recorded responses and a stand-in SDK approves at once,
 * so no sandbox money moves. With ROOMOVER_E2E_LIVE=1 the official button
 * opens the real sandbox popup, the judge buyer approves, and PayPal sends
 * the webhooks to the deployed app, which shares this database. Teardown
 * voids the authorization and puts the listings back on sale.
 */

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? "test-results/screenshots";
const WEBHOOK_WAIT_MS = 120_000;

async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const blocking = axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
}

test("the student approves one PayPal checkout and PayPal holds the money for every seller", async ({ page, session }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "The checkout runs once, on desktop.");
  test.skip(LIVE && BUYER_PASSWORD === undefined, "A live run needs PAYPAL_SANDBOX_BUYER_PASSWORD in .env.local.");
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
  if (LIVE) await expect(page.getByText(/Pay in 4 interest-free payments of \$25\.00/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-total]")).toHaveText("$100");
  await expectAccessible(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/checkout-ready-1440.png`, fullPage: true, scale: "css" });

  if (LIVE) {
    // Closing the popup before approving charges nothing and says how to go on.
    const firstPopup = page.waitForEvent("popup");
    await page.locator("paypal-button").click();
    const closing = await firstPopup;
    await closing.locator("input#email, input[name=login_email]").waitFor({ timeout: 45_000 });
    await closing.close();
    await expect(page.getByText("You closed PayPal before approving, so nothing was charged. Press PayPal when you are ready.")).toBeVisible({ timeout: 30_000 });
    const popupOpened = page.waitForEvent("popup");
    await page.locator("paypal-button").click();
    await approveInPopup(await popupOpened, `${SCREENSHOT_DIR}/checkout-popup-1440.png`);
  } else {
    await page.locator("paypal-button").click();
  }

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
  await expectNoPageScroll(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/checkout-held-1440.png`, fullPage: true, scale: "css" });

  // The order rows match the plan with one line per listing at its listed price, and the listings are reserved.
  const planListingIds = plan.layout.items.flatMap((item) => (item.source === "listing" ? [item.listingId] : []));
  const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.listingId));
  const listed = await db.select().from(listings).where(inArray(listings.id, planListingIds)).orderBy(asc(listings.id));
  expect(lines.map((line) => [line.listingId, line.sellerId, line.amountCents, line.status])).toEqual(listed.map((listing) => [listing.id, listing.sellerId, listing.priceCents, "authorized"]));
  expect(order.totalCents).toBe(listed.reduce((sum, listing) => sum + listing.priceCents, 0));
  expect(listed.every((listing) => listing.status === "reserved")).toBe(true);

  // A live run's PAYMENT.AUTHORIZATION.CREATED reaches the deployed route, which stores it once.
  let stored: (typeof webhookEvents.$inferSelect)[] = [];
  for (const started = Date.now(); LIVE && Date.now() - started < WEBHOOK_WAIT_MS && stored.length === 0; await page.waitForTimeout(3000)) {
    stored = await db.select().from(webhookEvents).where(eq(webhookEvents.resourceId, order.paypalAuthorizationId ?? ""));
  }
  if (LIVE) expect(stored.map((event) => event.eventType)).toEqual(["PAYMENT.AUTHORIZATION.CREATED"]);
  testInfo.annotations.push(
    { type: "paypal-order", description: order.paypalOrderId ?? "" },
    { type: "paypal-authorization", description: order.paypalAuthorizationId ?? "" },
    { type: "webhook-events", description: stored.map((event) => `${event.eventType} ${event.paypalEventId}`).join(", ") },
  );
  console.log(JSON.stringify({ order: order.paypalOrderId, authorization: order.paypalAuthorizationId, totalCents: order.totalCents, webhooks: stored.map((event) => [event.eventType, event.paypalEventId, event.receivedAt]) }));

  await page.getByRole("link", { name: "Go to handoff" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Handoff" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/handoff/${plan.id}$`));
  expect(problems).toEqual([]);
});
