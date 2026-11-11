import AxeBuilder from "@axe-core/playwright";
import { eq } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { getDb } from "@/lib/db/client";
import { loadCatalog } from "@/lib/db/plans";
import { listingDrafts, listings, users } from "@/lib/db/schema";
import { userId } from "@/scripts/seed/people";
import { CAMPUS } from "@/scripts/seed/campus";
import { captureFullHeight, expectFitsDesktops, expectNoPageScroll } from "./support/layout";
import { expect, test } from "./support/session";

// The stubbed login links seeded Ava, so the two widths take turns, and each leaves her account as it found it.
test.use({ holdsCatalog: true });

/**
 * Sell end to end. Ava logs in with PayPal (a stubbed round trip in the
 * default run), picks the black rolling cart sample, Channel3's recorded
 * image search and the seller agent's recorded reply fill in the listing
 * with the matched retail product and its new price, she enters the size
 * Channel3 lacks, and one press lists it. The listing then sits in the
 * catalog the buyer agent searches. Uploading the same cart through the
 * file picker replays a live run where no product was the same one, so the
 * similar products set the price.
 */

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? "test-results/screenshots";
const AVA = userId("ava");

async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const blocking = axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
}

test("a leaving student logs in with PayPal, lists a sample photo with Channel3's match, and the buyer agent can find it", async ({ page, session }, testInfo) => {
  test.setTimeout(180_000);
  const width = testInfo.project.name === "desktop-1440" ? 1440 : 390;
  const desktop = width === 1440;
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  const db = getDb();
  const [before] = await db.select({ paypalAccountId: users.paypalAccountId }).from(users).where(eq(users.id, AVA));

  try {
    // Signed out, Sell asks for Log in with PayPal first.
    await page.goto("/sell");
    await expect(page.getByRole("heading", { level: 1, name: "Sell an item" })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: /^Photo$/ })).toHaveAttribute("aria-current", "step");
    const login = page.getByRole("link", { name: "Log in with PayPal" });
    await expect(login).toBeVisible();
    await expectAccessible(page);
    await captureFullHeight(page, `${SCREENSHOT_DIR}/sign-in-${width}.png`);

    // PayPal sends Ava back, and the header names her. The recorded answer, like the sandbox's own, names no payer ID, so payouts go to her PayPal email.
    await login.click();
    await expect(page).toHaveURL(/\/sell$/);
    await expect(page.getByText("Signed in with PayPal as Ava Lindqvist")).toBeVisible();
    const [linked] = await db.select({ paypalAccountId: users.paypalAccountId, paypalEmail: users.paypalEmail }).from(users).where(eq(users.id, AVA));
    expect(linked).toEqual({ paypalAccountId: before.paypalAccountId, paypalEmail: "roomover-seller1-jin0608@personal.example.com" });
    if (before.paypalAccountId === null) await expect(page.getByText("Payouts go to the email on the PayPal account you logged in with.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Take a photo", exact: true })).toBeVisible();
    await expectAccessible(page);
    await captureFullHeight(page, `${SCREENSHOT_DIR}/photo-${width}.png`);

    // A sample photo runs Channel3, then the seller agent, and the panel says what each found.
    await page.getByRole("button", { name: "Black rolling cart" }).click();
    await expect(page.getByText(/^Channel3 found \d products like it$/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Check the details" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 2, name: "Black 3-tier rolling utility cart" })).toBeVisible();
    await expect(page.getByText("Filled in from your photo. New about $39. Channel3 has no size for this product, so enter it yourself.")).toBeVisible();
    await expect(page.locator("#sell-price")).toHaveText("$21");
    await expect(page.locator("#sell-floor")).toHaveText("$16");
    // The price stops at 70 percent of new, $27.
    for (let press = 0; press < 10; press++) {
      const raise = page.getByRole("button", { name: "Raise the price by $1" }).first();
      if (await raise.isDisabled()) break;
      await raise.click();
    }
    await expect(page.locator("#sell-price")).toHaveText("$27");
    for (let press = 0; press < 6; press++) await page.getByRole("button", { name: "Lower the price by $1" }).first().click();
    await expect(page.locator("#sell-price")).toHaveText("$21");

    // The Developer view names the Channel3 match, the seller agent's call, and where payouts go.
    await page.getByRole("switch", { name: "Developer view" }).click();
    const hood = page.getByRole("region", { name: "Developer view" });
    await expect(hood.getByText("Råskog Utility Cart")).toBeVisible();
    await expect(hood.getByText("identify_product_by_image, POST /v1/image-search")).toBeVisible();
    await expect(hood.getByText(/^Replayed from a recorded Claude reply, \d+\.\d s\.$/)).toBeVisible();
    await expect(hood.getByText("/v1/identity/oauth2/userinfo")).toBeVisible();

    // Listing without a size says what is missing.
    await page.getByRole("button", { name: "List for $21" }).click();
    await expect(page.getByText("Enter the width, depth, and height in inches, so the buyer agent can check it fits a room.")).toBeVisible();
    await page.getByLabel("Width").fill("17.5");
    await page.getByLabel("Depth").fill("14");
    await page.getByLabel("Height").fill("30.75");
    await expectAccessible(page);
    if (desktop) {
      await page.locator("[data-panel-body]").evaluate((body) => body.scrollTo({ top: 0 }));
      await page.screenshot({ path: `${SCREENSHOT_DIR}/details-${width}.png`, scale: "css" });
      await expectFitsDesktops(page, SCREENSHOT_DIR, "sell");
    } else {
      await captureFullHeight(page, `${SCREENSHOT_DIR}/details-${width}.png`);
    }

    await page.getByRole("button", { name: "List for $21" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Listed for $21" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("listitem").filter({ hasText: /^Listed$/ })).toHaveAttribute("aria-current", "step");
    await expectAccessible(page);
    await captureFullHeight(page, `${SCREENSHOT_DIR}/listed-${width}.png`);

    // Postgres holds an active listing for Ava with Channel3's retail reference, and the buyer agent's catalog includes it.
    const [draft] = await db.select({ listingId: listingDrafts.listingId, status: listingDrafts.status }).from(listingDrafts).where(eq(listingDrafts.sessionId, session));
    expect(draft.status).toBe("listed");
    const [listing] = await db.select().from(listings).where(eq(listings.id, draft.listingId ?? ""));
    expect([listing.sellerId, listing.status, listing.sessionId, listing.category, listing.priceCents, listing.floorPriceCents, listing.widthMm, listing.depthMm, listing.heightMm, listing.handoffMode]).toEqual([AVA, "active", session, "storage", 2_100, 1_600, 445, 356, 781, "direct"]);
    expect(listing.retailReference).toMatchObject({ source: "channel3", channel3ProductId: "OZSFCDr", newPriceCents: 3_900 });
    expect(listing.photos[0].src).toBe("/sell-samples/black-rolling-cart.jpg");
    const catalog = await loadCatalog(db, CAMPUS);
    expect(catalog.find((entry) => entry.id === listing.id)).toMatchObject({ title: "Black 3-tier rolling utility cart", priceCents: 2_100, sellerName: "Ava Lindqvist" });

    // List another item starts over at the photo.
    await page.getByRole("button", { name: "List another item" }).click();
    await expect(page.getByRole("button", { name: "Take a photo", exact: true })).toBeVisible();
    expect(problems).toEqual([]);
  } finally {
    await db.update(users).set({ paypalAccountId: before.paypalAccountId }).where(eq(users.id, AVA));
  }
});

test("an uploaded cart with no exact match prices from similar Channel3 products and suggests a size to check", async ({ page, session }, testInfo) => {
  test.setTimeout(120_000);
  const width = testInfo.project.name === "desktop-1440" ? 1440 : 390;
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  const db = getDb();
  const [before] = await db.select({ paypalAccountId: users.paypalAccountId }).from(users).where(eq(users.id, AVA));
  try {
    await page.goto("/sell");
    await page.getByRole("link", { name: "Log in with PayPal" }).click();
    await expect(page.getByText("Signed in with PayPal as Ava Lindqvist")).toBeVisible();

    // The browser shrinks and saves the photo the same way every time, so the recorded live Channel3 search and seller agent reply answer this upload.
    await page.locator('input[type="file"]').setInputFiles("public/sell-samples/black-rolling-cart.jpg");
    await expect(page.getByText("Channel3 found 4 products like it")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 2, name: "Black three tier rolling cart with mesh bottoms" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Filled in from your photo. No exact match on Channel3. 3 similar items sell new for about $40, so your price starts there.")).toBeVisible();
    await expect(page.getByText(/matches it/)).toHaveCount(0);
    const similar = page.getByRole("region", { name: "Similar new items on Channel3" });
    await expect(similar.getByRole("listitem")).toHaveText([/^3-tier Utility Cart\s*homedepot\.com\s*\$63\.81$/, /^Råskog Utility Cart\s*ikea\.com\s*\$39$/, /^Famous Brand 3-Tier Foldable Rolling Cart\s*boscovs\.com\s*\$39\.99$/]);
    await expect(page.locator("#sell-price")).toHaveText("$18");
    await expect(page.locator("#sell-floor")).toHaveText("$13");

    // The closest similar product that states a size fills the fields, which stay editable.
    const size = page.getByRole("group", { name: "Size in inches" });
    await expect(size.getByText("From a similar item. Check before you list.")).toBeVisible();
    await expect(page.getByLabel("Width")).toHaveValue("17");
    await expect(page.getByLabel("Depth")).toHaveValue("11");
    await expect(page.getByLabel("Height")).toHaveValue("30");
    await expect(page.getByLabel("Width")).toHaveAccessibleDescription("From a similar item. Check before you list.");
    await expectAccessible(page);
    if (width === 1440) {
      await page.locator("[data-panel-body]").evaluate((body) => body.scrollTo({ top: 0 }));
      await page.screenshot({ path: `${SCREENSHOT_DIR}/sell-similar-${width}.png`, scale: "css" });
      await size.evaluate((fields) => fields.scrollIntoView({ block: "center" }));
      await page.screenshot({ path: `${SCREENSHOT_DIR}/sell-similar-size-${width}.png`, scale: "css" });
    } else {
      await captureFullHeight(page, `${SCREENSHOT_DIR}/sell-similar-${width}.png`);
    }

    // The Developer view shows the query, every product Channel3 returned, which ones the agent picked, and the reference code computed.
    await page.getByRole("switch", { name: "Developer view" }).click();
    const developer = page.getByRole("region", { name: "Developer view" });
    await expect(developer.getByText("Query: Your photo as base64, limit 6, US, USD, lengths in cm.")).toBeVisible();
    await expect(developer.getByText("The seller agent found no candidate that is the same product and picked 3 as the same kind of item.")).toBeVisible();
    const returned = developer.getByRole("list", { name: "Products Channel3 returned" }).getByRole("listitem");
    await expect(returned).toHaveCount(4);
    await expect(returned.filter({ hasText: "picked as similar" })).toHaveCount(3);
    await expect(returned.filter({ hasText: "NISSAFORS trolley" })).toContainText("not picked");
    await expect(developer.getByText("Reference computed in code, the median of $39, $39.99, and $63.81 rounded to the dollar, $40.")).toBeVisible();
    await expectAccessible(page);
    if (width === 1440) {
      await developer.evaluate((region) => region.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: `${SCREENSHOT_DIR}/developer-view.png`, scale: "css" });
    }

    // A size the seller corrects wins, and the listing names its reference as similar products, never a match.
    await page.getByLabel("Depth").fill("11.5");
    await page.getByRole("button", { name: "List for $18" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Listed for $18" })).toBeVisible({ timeout: 30_000 });
    const [draft] = await db.select({ listingId: listingDrafts.listingId }).from(listingDrafts).where(eq(listingDrafts.sessionId, session));
    const [listing] = await db.select().from(listings).where(eq(listings.id, draft.listingId ?? ""));
    expect([listing.priceCents, listing.floorPriceCents, listing.widthMm, listing.depthMm, listing.heightMm]).toEqual([1_800, 1_300, 432, 292, 762]);
    expect(listing.retailReference).toMatchObject({ source: "channel3_similar", newPriceCents: 4_000, sourceNote: "Median new price of 3 similar products Channel3 found, because none is the same product." });
    expect(listing.retailReference.channel3ProductId).toBeUndefined();
    expect(problems).toEqual([]);
  } finally {
    await db.update(users).set({ paypalAccountId: before.paypalAccountId }).where(eq(users.id, AVA));
  }
});

test("a photo of something Roomover does not list, or no confident match, says so in a plain sentence", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One width is enough for the no match path.");
  test.setTimeout(120_000);
  const db = getDb();
  const [before] = await db.select({ paypalAccountId: users.paypalAccountId }).from(users).where(eq(users.id, AVA));
  try {
    await page.goto("/sell");
    await page.getByRole("link", { name: "Log in with PayPal" }).click();
    await page.getByRole("button", { name: "White side chair" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "White tufted molded side chair with wood legs" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Channel3 found no product that matches it, so the seller agent estimated the new price, about \$\d+, and you enter the size\./)).toBeVisible();
    await expect(page.getByRole("group", { name: "Size in inches" })).toBeVisible();
    await page.getByRole("switch", { name: "Developer view" }).click();
    await expect(page.getByText("The seller agent found no candidate that is the same product.")).toBeVisible();
    await expectNoPageScroll(page);
  } finally {
    await db.update(users).set({ paypalAccountId: before.paypalAccountId }).where(eq(users.id, AVA));
  }
});
