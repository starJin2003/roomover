import AxeBuilder from "@axe-core/playwright";
import { asc, eq, inArray } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { getDb } from "@/lib/db/client";
import { listings, orderItems, orders, payoutItems, payouts } from "@/lib/db/schema";
import { createDemoPlan } from "@/scripts/handoff/demo-plan";
import { payDemoCart, payDemoCartAtDesktop } from "./support/demo-checkout";
import { expectFitsDesktops } from "./support/layout";
import { BUYER_PASSWORD } from "./support/paypal-popup";
import { LIVE } from "./support/sandbox";
import { expect, test } from "./support/session";

test.use({ holdsCatalog: true });

/**
 * Handoff end to end on the five seller demo cart. A checkout holds $144
 * (the recorded sandbox by default, the real one with ROOMOVER_E2E_LIVE=1), the student checks each item with its sample photo while the
 * verifier replays its recorded comparisons, the torn chair is confirmed at
 * $30, PayPal captures each kept item from the authorization, and one
 * Payouts batch pays the five sellers while their rows fill. Teardown voids
 * anything still held, deletes the session's rows, and puts the listings
 * back on sale.
 */

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? "test-results/screenshots";
const PAYOUT_WAIT_MS = 240_000;
const CART = [
  { noun: "desk", seller: "Jun", priceCents: 5_500, payCents: 5_500 },
  { noun: "chair", seller: "Marcus", priceCents: 3_500, payCents: 3_000 },
  { noun: "lamp", seller: "Ava", priceCents: 1_600, payCents: 1_600 },
  { noun: "clamp lamp", seller: "Sofia", priceCents: 800, payCents: 800 },
  { noun: "bean bag", seller: "Lea", priceCents: 3_000, payCents: 3_000 },
] as const;

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

/** Checks one item with its sample photo and waits for the verifier's sentence. */
async function checkWithSample(page: Page, sample: "Use a sample photo" | "Sample with a new tear", finding: string) {
  await page.getByRole("button", { name: sample }).click();
  await expect(page.locator("[data-finding]")).toHaveText(finding, { timeout: 30_000 });
}

test("the student checks every item, the torn chair costs $30, and PayPal pays five sellers in one batch", async ({ page, session, browser, baseURL }, testInfo) => {
  test.skip(LIVE && BUYER_PASSWORD === undefined, "A live run needs PAYPAL_SANDBOX_BUYER_PASSWORD in .env.local.");
  test.setTimeout(480_000);
  const desktop = testInfo.project.name === "desktop-1440";
  const width = desktop ? 1440 : 390;
  const problems = watchConsole(page);
  const planId = await createDemoPlan(getDb(), session);

  if (desktop) {
    await payDemoCart(page);
    await page.getByRole("link", { name: "Go to handoff" }).click();
  } else {
    await payDemoCartAtDesktop(browser, baseURL ?? "", session);
    await page.goto("/handoff");
  }
  await expect(page).toHaveURL(new RegExp(`/handoff/${planId}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Handoff" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: /^Handoff$/ })).toHaveAttribute("aria-current", "step");
  await expect(page.getByText("PayPal is holding $144")).toBeVisible();

  // Camera first. The seller's photo shows the angle to match, and the action takes a photo.
  await expect(page.getByText("Jun's photo. Match this angle, item 1 of 5.")).toBeVisible();
  if (!desktop) {
    await expect(page.getByRole("button", { name: "Take a photo" })).toBeVisible();
    await expect(page.locator("[data-room]").filter({ visible: true })).toHaveCount(0);
    await expectAccessible(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/camera-first-390.png`, fullPage: true, scale: "css" });
  } else {
    await expect(page.getByRole("button", { name: "Add a photo of the desk" })).toBeVisible();
    await expect(page.locator("[data-room]").filter({ visible: true })).toHaveAttribute("data-ring", "jun-white-desk");
  }

  if (desktop) {
    // A photo from the device uploads, shrinks, and stays private to this browser. Nothing recorded matches its bytes, so the comparison fails visibly.
    await page.locator('input[type="file"]').first().setInputFiles("public/handoff-samples/jun-white-desk.jpg");
    await expect(page.locator("[data-current-item]").getByText("The verifier could not reach Claude just now. Try again in a moment.")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-check="failed"]')).toContainText("Jun, photo not compared");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    const src = await page.getByAltText("Your handoff photo of the desk").getAttribute("src");
    expect(src).toMatch(/^\/api\/handoff\/photos\/[0-9a-f-]{36}$/);
    const own = await page.request.get(src ?? "");
    expect(own.status()).toBe(200);
    expect(own.headers()["content-type"]).toBe("image/jpeg");
    expect(own.headers()["x-content-type-options"]).toBe("nosniff");
    const stranger = await browser.newContext();
    expect((await stranger.request.get(`${baseURL}${src}`)).status()).toBe(404);
    await stranger.close();
  }
  await checkWithSample(page, "Use a sample photo", "Jun's desk matches the listing.");
  await page.getByRole("button", { name: "Confirm, pay $55" }).click();
  await expect(page.getByText("Marcus's photo. Match this angle, item 2 of 5.")).toBeVisible();
  if (desktop) {
    await expect(page.locator("[data-room]").filter({ visible: true })).toHaveAttribute("data-ring", "marcus-mesh-desk-chair");
    await page.waitForTimeout(600);
    await expectAccessible(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/checking-1440.png`, fullPage: true, scale: "css" });
  }

  // The torn chair. The verifier finds the tear, code sets the price, and one tap confirms it.
  await checkWithSample(page, "Sample with a new tear", "Marcus's chair has a new 3 cm tear. You pay $30 of $35.");
  await expect(page.getByRole("button", { name: "Confirm, pay $30" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn it down" })).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/torn-chair-decision-${width}.png`, fullPage: true, scale: "css" });
  await page.getByRole("button", { name: "Confirm, pay $30" }).click();
  await expect(page.locator('[data-check="adjusted"]')).toContainText("Marcus, new tear, you pay $30");

  await checkWithSample(page, "Use a sample photo", "Ava's lamp matches the listing.");
  await page.getByRole("button", { name: "Confirm, pay $16" }).click();
  await checkWithSample(page, "Use a sample photo", "Sofia's clamp lamp matches the listing.");
  await page.getByRole("button", { name: "Confirm, pay $8" }).click();
  await checkWithSample(page, "Use a sample photo", "Lea's bean bag matches the listing.");
  await page.getByRole("button", { name: "Confirm, pay $30" }).click();

  // The last tap moves the money. The panel turns into the sellers paid result on the same screen.
  await expect(page.getByRole("heading", { level: 1, name: "Handoff done" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("listitem").filter({ hasText: /^Sellers paid$/ })).toHaveAttribute("aria-current", "step");
  await expect(page.getByText("You got $5 back for the chair's new tear.")).toBeVisible();
  await expect(page.locator('[data-paypal-moment="captured"]')).toContainText("PayPal captured $139");
  const rows = page.locator("li[data-paid]");
  await expect(rows).toHaveCount(5);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/sellers-paid-filling-${width}.png`, fullPage: true, scale: "css" });

  await expect(page.locator('li[data-paid="true"]')).toHaveCount(5, { timeout: PAYOUT_WAIT_MS });
  await expect(page.getByText("sent to 5 sellers", { exact: true })).toBeVisible();
  await expect(page.locator('[data-paypal-moment="paid"]')).toContainText("PayPal paid 5 sellers $139");
  await page.getByRole("switch", { name: "Developer view" }).click();

  // Postgres agrees with the screen, and the Developer view names every PayPal ID.
  const db = getDb();
  const [order] = await db.select().from(orders).where(eq(orders.planId, planId));
  expect(order.status).toBe("settled");
  const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  expect(lines.map((line) => line.capturedAmountCents).sort((a, b) => a - b)).toEqual(CART.map((item) => item.payCents).sort((a, b) => a - b));
  expect(lines.every((line) => line.paypalCaptureId !== null && line.payoutItemId !== null)).toBe(true);
  // The screen keeps reading the batch until PayPal reports it finished.
  await expect.poll(async () => (await db.select({ status: payouts.status }).from(payouts).where(eq(payouts.orderId, order.id)))[0]?.status, { timeout: 60_000 }).toBe("success");
  const [payout] = await db.select().from(payouts).where(eq(payouts.orderId, order.id));
  expect(payout.senderBatchId).toBe(`rmv.payout.${order.id}.1`);
  expect(payout.totalCents).toBe(13_900);
  const paid = await db.select().from(payoutItems).where(eq(payoutItems.payoutId, payout.id)).orderBy(asc(payoutItems.amountCents));
  expect(paid.map((item) => [item.amountCents, item.status])).toEqual([
    [800, "succeeded"],
    [1_600, "succeeded"],
    [3_000, "succeeded"],
    [3_000, "succeeded"],
    [5_500, "succeeded"],
  ]);
  // Once every seller is paid, the seeded listings go back on sale, so the demo catalog never drains.
  await expect.poll(async () => (await db.select({ status: listings.status }).from(listings).where(inArray(listings.id, lines.map((line) => line.listingId)))).map((listing) => listing.status), { timeout: 30_000 }).toEqual(["active", "active", "active", "active", "active"]);
  const paidCard = page.locator('[data-paypal-moment="paid"]');
  await expect(paidCard.getByText(payout.paypalBatchId ?? "")).toBeVisible();
  for (const item of paid) await expect(paidCard.getByText(item.paypalPayoutItemId ?? "")).toBeVisible();
  for (const line of lines) await expect(page.locator('[data-paypal-moment="captured"]').getByText(line.paypalCaptureId ?? "")).toBeVisible();
  await expectAccessible(page);
  // The longest Handoff state, five paid sellers and every ID in the Developer view, still fits the desktop window.
  if (desktop) await expectFitsDesktops(page, SCREENSHOT_DIR, "handoff");
  await page.screenshot({ path: `${SCREENSHOT_DIR}/sellers-paid-done-${width}.png`, fullPage: true, scale: "css" });

  console.log(JSON.stringify({ project: testInfo.project.name, order: order.paypalOrderId, authorization: order.paypalAuthorizationId, captures: lines.map((line) => line.paypalCaptureId), batch: payout.paypalBatchId, items: paid.map((item) => item.paypalPayoutItemId) }));
  expect(problems).toEqual([]);
});
