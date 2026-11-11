import AxeBuilder from "@axe-core/playwright";
import { asc, eq } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { getDb } from "@/lib/db/client";
import { loadNegotiations } from "@/lib/db/negotiations";
import { latestSessionPlan } from "@/lib/db/plans";
import { orderItems, orders } from "@/lib/db/schema";
import { captureFullHeight, expectFitsDesktops, openRoomList } from "./support/layout";
import { expect, test } from "./support/session";

test.use({ holdsCatalog: true });

/**
 * Negotiation and Channel3 gap filling in Birchwood House, where no used
 * bedding is offered. The buyer agent replays its recorded plan, the seller
 * agents replay their recorded answers by offer, and Channel3 replays its
 * recorded searches, so nothing reaches Claude or Channel3. Both sellers
 * counter, the buyer agent takes both counters, a new throw from Lands' End
 * fills the bedding gap, and the PayPal order holds the agreed prices of the
 * used items and nothing else.
 */

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? "test-results/screenshots";
const PROMPT = "$120, cozy, I study late, I already have storage";
const SLOT = String.raw`\w{3}, \w{3} \d{1,2}, noon to 2 PM`;

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

const sentence = (page: Page, text: string | RegExp) => page.locator("ul[aria-live] [data-sentence]").filter({ hasText: text });

async function planBirchwood(page: Page): Promise<void> {
  await page.goto("/furnish");
  await page.locator('input[name=preset][value="birchwood-house-single"]').check();
  await page.getByLabel("What should your room feel like?").fill(PROMPT);
  await page.getByRole("button", { name: "Plan my room" }).click();
  await expect(sentence(page, "No used bedding fits, so here is a new throw from landsend.com for $15.72.")).toBeVisible({ timeout: 60_000 });
  await expect(sentence(page, "Jun's agent countered at $38 for the round rug and chair.")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("ul[aria-live] [data-sentence]").last()).toHaveText("Your room is ready. 3 items from 2 students and 1 new item.", { timeout: 60_000 });
}

test("the buyer agent negotiates with each seller and fills a gap with a new item from Channel3", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const problems = watchConsole(page);
  const size = testInfo.project.name === "desktop-1440" ? "1440" : "390";
  await planBirchwood(page);

  const shown = page.locator("ul[aria-live] [data-sentence]");
  await expect(shown.nth(0)).toHaveText(new RegExp(`^Took Jun's counter of \\$38 for the round rug and chair with handoff ${SLOT}\\.$`));
  await expect(shown.nth(1)).toHaveText("Prepared one PayPal checkout for $53 from 2 students. It waits for your approval.");

  // The PayPal amount is the agreed used items, the new throw is its own line, and savings compare with Channel3's new prices.
  await expect(page.locator("[data-total]")).toHaveText("$53");
  await expect(page.getByText("through PayPal for the used items")).toBeVisible();
  const line = page.locator("[data-new-item-line]");
  await expect(line).toHaveText("Plus $15.72 for a new cozy anyweather fleece throw blanket, bought at landsend.com, opens in a new tab");
  await expect(line.getByRole("link")).toHaveAttribute("href", /^https:\/\/buy\.trychannel3\.com\//);
  await expect(page.getByText("$68.72 of your $120 in all")).toBeVisible();
  await expect(page.locator("[data-savings]")).toHaveText(/^\$[\d,.]+ less than the cheapest comparable new items on Channel3$/);

  // The list strikes through each asking price beside the agreed one and marks the new item with its retailer and a buy link.
  await openRoomList(page);
  const rug = page.locator("[data-item]").filter({ hasText: "Round jute and cotton rug" });
  await expect(rug).toContainText("$20");
  await expect(rug.locator("s")).toHaveText("$22");
  await expect(rug).toContainText(new RegExp(`Jun Park, good, ${SLOT}`));
  const throwRow = page.locator("[data-new-item]");
  await expect(throwRow).toContainText("New from landsend.com");
  await expect(page.getByRole("link", { name: /^Buy the Cozy Anyweather Fleece Throw Blanket at landsend\.com/ })).toHaveAttribute("href", /^https:\/\/buy\.trychannel3\.com\//);
  await expectAccessible(page);
  await captureFullHeight(page, `${SCREENSHOT_DIR}/negotiate-ready-${size}.png`);

  // The Developer view lists every offer and counter and the Channel3 search with its credits.
  await page.getByRole("switch", { name: "Developer view" }).click();
  const deals = page.locator("[data-negotiation]");
  await expect(deals).toHaveCount(2);
  const jun = deals.filter({ hasText: "Jun, round jute and cotton rug, 4 feet and black wood chair with red velvet seat" });
  await expect(jun).toContainText("Agreed $38 of $42");
  await expect(jun).toContainText("Jun's agent countered at $38");
  await expect(deals.filter({ hasText: "Ava, black balance arm desk lamp" })).toContainText("Agreed $15 of $16");
  const search = page.locator("[data-channel3-search]");
  await expect(search).toContainText("Search for “cozy throw blanket”, under $40");
  await expect(search).toContainText("search_new_products, 10 products, 4 fit, 0 credits");
  await expectAccessible(page);
  await captureFullHeight(page, `${SCREENSHOT_DIR}/negotiate-under-the-hood-${size}.png`);

  if (size === "1440") await expectFitsDesktops(page, SCREENSHOT_DIR, "negotiate");
  else expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  expect(problems).toEqual([]);
});

test("the PayPal order holds the negotiated prices of the used items and nothing else", async ({ page, session }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "The checkout runs once, on desktop.");
  test.setTimeout(180_000);
  const problems = watchConsole(page);
  await planBirchwood(page);
  await expect(page.locator('[data-paypal-checkout="ready"]')).toBeVisible({ timeout: 30_000 });
  await page.locator("paypal-button").click();
  await expect(page.getByText("PayPal holds your $53 until handoff")).toBeVisible({ timeout: 60_000 });

  const db = getDb();
  const plan = await latestSessionPlan(db, session);
  if (plan === null) throw new Error("The session has no plan.");
  const [order] = await db.select().from(orders).where(eq(orders.planId, plan.id));
  const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.listingId));
  const agreed = new Map((await loadNegotiations(db, plan.id)).map((row) => [row.listingId, row]));
  const usedItems = plan.layout.items.filter((item) => item.source === "listing");
  expect(plan.layout.items.filter((item) => item.source === "new_product")).toHaveLength(1);
  expect(order).toMatchObject({ status: "authorized", paymentMode: "authorize_then_capture", totalCents: 5_300 });
  expect(lines).toHaveLength(usedItems.length);
  for (const line of lines) {
    const terms = agreed.get(line.listingId);
    expect(terms?.status).toBe("agreed");
    expect(line.amountCents).toBe(terms?.agreedPriceCents);
    expect(line.slotStartsAt?.getTime()).toBe(terms?.agreedSlot?.startsAt.getTime());
  }
  expect(lines.map((line) => line.amountCents).sort((a, b) => a - b)).toEqual([1_500, 1_800, 2_000]);
  expect(problems).toEqual([]);
});
