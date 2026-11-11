import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { getDb } from "@/lib/db/client";
import { countActiveListings } from "@/lib/db/plans";
import { CAMPUS } from "@/scripts/seed/campus";
import { captureFullHeight, expectFitsDesktops, openRoomList } from "./support/layout";
import { LIVE } from "./support/sandbox";
import { expect, test } from "./support/session";

/**
 * The Furnish flow end to end against a recorded Claude conversation, which
 * the test server replays (see playwright.config.ts). Every hard check runs
 * for real on the server, so the recorded placements still pass through the
 * budget, hall rule, and fit checks, and create_checkout prepares an order
 * in the recorded sandbox (the real one with ROOMOVER_E2E_LIVE=1). Each test
 * runs in a tagged session whose plans, runs, events, and orders are deleted
 * when it ends.
 */

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? "test-results/screenshots";
const BEAN_BAG = "navy-bean-bag-chair-with-matching-pouf";
const RECORDED_ITEMS = ["black-balance-arm-desk-lamp", "round-jute-and-cotton-rug-4-feet", BEAN_BAG, "granny-square-crochet-throw", "orange-storage-tote-with-attached-lid", "reversible-comforter-blue-and-cream-prin"];

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const blocking = axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

async function capture(page: Page, name: string, width: number) {
  await captureFullHeight(page, `${SCREENSHOT_DIR}/${name}-${width}.png`);
}

const widthOf = (project: string) => Number(project.split("-").at(-1));
const sentences = (page: Page) => page.locator("#furnish-panel-title").locator("xpath=ancestor::section[1]").locator("ul[aria-live] [data-sentence]");

// The count on Home is the live catalog, which a Sell test's listing or a paid order changes, so this takes its turn with them.
test.describe("Home", () => {
  test.use({ holdsCatalog: true });

  test("Home offers the two choices over the furnished room", async ({ page }, testInfo) => {
    const problems = watchConsole(page);
    await page.goto("/");
    await expect(page).toHaveTitle("Roomover");
    await expect(page.getByRole("heading", { level: 1, name: "Furnish your dorm room from students moving out" })).toBeVisible();
    // The count is the catalog, the 24 seeded listings plus any a Sell run listed in the last day. Home caches it for a few minutes, so it may still leave out the five demo cart listings another test held just before.
    const active = await countActiveListings(getDb(), CAMPUS);
    expect(active).toBeGreaterThanOrEqual(24);
    const shown = await page.getByText(/^\d+ items from students leaving Lakeshore University this term$/).innerText();
    expect(Number(shown.split(" ")[0])).toBeGreaterThanOrEqual(19);
    await expect(page.getByRole("link", { name: /Furnish a room/ })).toHaveAttribute("href", "/furnish");
    await expect(page.getByRole("link", { name: /Sell items/ })).toHaveAttribute("href", "/sell");
    await expect(page.locator('[data-room="harbor-hall-double"]')).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    await expect(page.locator('[data-room="harbor-hall-double"]')).toHaveAttribute("data-placed", "5");
    await expectNoOverflow(page);
    await expectAccessible(page);
    await capture(page, "home", widthOf(testInfo.project.name));
    expect(problems).toEqual([]);
  });
});

test.describe("the buyer agent", () => {
  // The recorded plan places specific listings, so this waits while a paying test holds them.
  test.use({ holdsCatalog: true });

  test("the buyer agent furnishes Harbor Hall 214, prepares checkout, and edits by hand and in words persist", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const width = widthOf(testInfo.project.name);
    const problems = watchConsole(page);
    const room = page.locator('[data-room="harbor-hall-double"]');

    // The plan state starts on Jordan's room and needs a budget in the student's words.
    await page.goto("/furnish");
    await expect(room).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    await expect(page.getByRole("radio", { name: /Harbor Hall 214/ })).toBeChecked();
    await expect(page.getByRole("listitem").filter({ hasText: "Plan" }).first()).toHaveAttribute("aria-current", "step");
    await expectNoOverflow(page);
    await expectAccessible(page);
    await capture(page, "plan", width);

    const prompt = page.getByLabel("What should your room feel like?");
    await prompt.fill("cozy, I study late");
    await page.getByRole("button", { name: "Plan my room" }).click();
    await expect(page.getByText("Add a budget in dollars, for example $150.")).toBeVisible();
    await prompt.fill("$150, cozy, I study late");
    await page.getByRole("button", { name: "Plan my room" }).click();

    // While the room fills, items land one at a time and the panel tells the story.
    await expect(room).toHaveAttribute("data-placed", "1", { timeout: 20_000 });
    await expect(page.getByText(/^Placing items, \d so far$/)).toBeVisible();
    await capture(page, "filling", width);

    // The ready room covers seating, lighting, storage, the floor, and comfort within budget, prepares one PayPal order, and shows the official buttons.
    await expect(sentences(page).last()).toHaveText("Your room is ready. 6 items from 4 students.", { timeout: 30_000 });
    await expect(room).toHaveAttribute("data-placed", "6", { timeout: 10_000 });
    const keys = await room.locator("ol [data-item]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-item")));
    expect(keys).toEqual(RECORDED_ITEMS);
    await expect(page.locator("[data-total]")).toHaveText("$107");
    await expect(page.getByText("$260.97 less than the cheapest comparable new items on Channel3")).toBeVisible();
    await expect(page.getByText("Prepared one PayPal checkout for $107 from 4 students. It waits for your approval.")).toBeVisible();
    await expect(page.locator('[data-paypal-checkout="ready"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("paypal-button")).toBeVisible();
    // The Pay Later message comes from PayPal's own servers, so only a live run shows its words.
    if (LIVE) await expect(page.getByText(/Pay in 4 interest-free payments of \$26\.75/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("listitem").filter({ hasText: /^Pay$/ })).toHaveAttribute("aria-current", "step");
    await expectNoOverflow(page);
    await expectAccessible(page);
    await capture(page, "ready", width);
    // The Sky ring under the last item the agent placed fades a couple of seconds after it lands.
    await expect(room).toHaveAttribute("data-ring", "", { timeout: 8_000 });
    await capture(page, "furnish-ring-faded", width);
    await page.locator("summary", { hasText: /^Details, \d+ steps$/ }).click();
    // Code reads the rules and the room before the first model call, so those steps come right after the start.
    const steps = page.locator("details ol > li");
    await expect(steps.nth(1)).toContainText("Read the Harbor Hall room standards");
    await expect(steps.nth(2)).toContainText("Read Harbor Hall 214");
    await expect(page.getByText(/Green metal floor reading lamp, halogen bulb from Marcus Bell\. Harbor Hall rule 1\.1/)).toBeVisible();
    await page.getByRole("switch", { name: "Developer view" }).click();
    await expect(page.locator("code", { hasText: "place_item" }).first()).toBeVisible();
    await expect(page.getByText(/^Run [0-9a-f-]{36}$/).first()).toBeVisible();
    await expect(page.getByText(/^Order [A-Z0-9]{17}, sandbox$/)).toBeVisible();
    await expectNoOverflow(page);
    await expectAccessible(page);
    // The longest Furnish state, every step open with the Developer view on, still fits the desktop window.
    if (width >= 1024) await expectFitsDesktops(page, SCREENSHOT_DIR, "furnish");
    await capture(page, "under-the-hood", width);
    await page.locator("summary", { hasText: /^Details, \d+ steps$/ }).click();
    await openRoomList(page);

    // The keyboard walks the bean bag west until it fails, which shows the Brick outline, and Escape puts it back.
    const seatRow = page.locator(`[data-item="${BEAN_BAG}"]`);
    await seatRow.focus();
    for (let press = 0; press < 30 && (await room.getAttribute("data-invalid")) !== "true"; press++) await page.keyboard.press("ArrowLeft");
    await expect(room).toHaveAttribute("data-invalid", "true");
    await expect(seatRow).toHaveAttribute("data-invalid", "true");
    await expect(page.locator("[data-room-toolbar]").getByText("It would overlap the west desk chair.")).toBeVisible();
    await capture(page, "editing-invalid", width);
    await page.keyboard.press("Escape");
    await expect(room).toHaveAttribute("data-invalid", "false");

    // A valid nudge saves on its own after a short pause.
    const saved = page.waitForResponse((response) => response.url().endsWith("/layout") && response.request().method() === "PATCH");
    await seatRow.focus();
    await page.keyboard.press("ArrowUp");
    expect((await saved).status()).toBe(200);
    // The stage says so once it has taken the answer in. Until then Escape would still put the tried spot back.
    await expect(page.locator('p[aria-live="polite"]', { hasText: /^Moved the bean bag / })).toBeAttached();
    // Keys keep the item selected for the next press, and Escape lets go of it.
    await expect(room).toHaveAttribute("data-selected", BEAN_BAG);
    await page.keyboard.press("Escape");
    await expect(room).toHaveAttribute("data-selected", "");
    // A click on the room where no item stands lets go too.
    await seatRow.click();
    await expect(room).toHaveAttribute("data-selected", BEAN_BAG);
    const roomBox = await page.locator("[data-room-box]").boundingBox();
    if (roomBox === null) throw new Error("The room has no box.");
    await page.mouse.click(roomBox.x + 6, roomBox.y + 6);
    await expect(room).toHaveAttribute("data-selected", "");

    // A pointer drag onto a spot that fails shows Brick, and the item does not drop there.
    if (width >= 600) {
      let patches = 0;
      page.on("request", (request) => {
        if (request.method() === "PATCH") patches += 1;
      });
      await seatRow.hover();
      const tag = page.locator("[data-room-tag]");
      await expect(tag).toBeVisible();
      const box = await page.locator("[data-room-box]").boundingBox();
      const tagBox = await tag.boundingBox();
      if (box === null || tagBox === null) throw new Error("The room or its tag has no box.");
      const grab = { x: tagBox.x + tagBox.width / 2, y: tagBox.y + tagBox.height + 36 };
      await page.mouse.move(grab.x, grab.y);
      await page.mouse.down();
      await page.mouse.move(grab.x - 40, grab.y, { steps: 4 });
      await page.mouse.move(box.x + 8, grab.y + 40, { steps: 16 });
      await expect(room).toHaveAttribute("data-invalid", "true");
      await page.mouse.up();
      await expect(room).toHaveAttribute("data-invalid", "false");
      await page.waitForTimeout(500);
      expect(patches).toBe(0);
    }

    // Asked in words, the agent moves the bean bag through the same tools and checks.
    await page.getByLabel("Ask the agent for a change").fill("Move the bean bag next to the window");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(sentences(page).last()).toHaveText("Your room is updated. 6 items, $107 of $150.", { timeout: 30_000 });
    await expect(page.locator("[data-sentence]", { hasText: "Moved the bean bag under the window." })).toBeVisible();

    // A reload shows the same room and the same story, with no ring, since nothing was placed just now.
    await page.reload();
    await expect(room).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    await expect(room).toHaveAttribute("data-placed", "6");
    await expect(room).toHaveAttribute("data-ring", "");
    await expect(sentences(page).last()).toHaveText("Your room is updated. 6 items, $107 of $150.");
    await expect(page.locator("[data-total]")).toHaveText("$107");
    expect(problems).toEqual([]);
  });
});
