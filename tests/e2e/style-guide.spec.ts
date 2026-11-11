import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Screenshots go where SCREENSHOT_DIR points, and to the ignored test results folder otherwise.
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? "test-results/screenshots";

test("style guide renders cleanly, passes axe, and stays out of search", async ({ page }, testInfo) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

  await page.goto("/style-guide");
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveTitle("Roomover style guide");
  await expect(page.getByRole("heading", { level: 1, name: "Roomover style guide" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");

  // Images below the fold load lazily, so scroll through once before checking layout.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
  });
  await expect(page.locator('[data-room="harbor-hall-double"]')).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  // Five PayPal monograms and five handoff thumbnails.
  await expect(page.locator("img")).toHaveCount(10);
  for (const image of await page.locator("img").all()) {
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const blocking = axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);

  // At 2x the mobile page runs past the GPU's largest capture, so full page shots use CSS pixels.
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${testInfo.project.name}.png`, fullPage: true, scale: "css" });
  expect(problems).toEqual([]);
});

test("the Developer view reveals the PayPal API name and sandbox ID under every PayPal step", async ({ page }) => {
  await page.goto("/style-guide");
  const moments = page.locator('section[aria-labelledby="paypal-moments-title"]');
  const ids = ["8RU61172JS455403V", "0TF88542GM8203619", "2GG279541U471931P", "7XJ4TQ2HW9N3E"];
  for (const id of ids) await expect(moments.getByText(id)).toHaveCount(0);

  const toggle = moments.getByRole("switch", { name: "Developer view" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  for (const id of ids) await expect(moments.getByText(id)).toBeVisible();
  await expect(moments.getByText("PayPal Payments v2")).toHaveCount(2);

  const done = page.locator('section[aria-labelledby="handoff-done-title"]');
  await expect(done.getByText("7XJ4TQ2HW9N3E")).toHaveCount(0);
  await done.getByRole("switch", { name: "Developer view" }).click();
  await expect(done.getByText("7XJ4TQ2HW9N3E")).toBeVisible();
});

test("sellers paid fills each row as its payout event arrives and ends on the full total", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // The replay fires one payout event every 600 ms. A paused clock steps through them, so a busy machine cannot merge two.
  await page.clock.install();
  await page.goto("/style-guide");
  const done = page.locator('section[aria-labelledby="handoff-done-title"]');
  const paidRows = done.locator('li[data-paid="true"]');
  await expect(paidRows).toHaveCount(5);
  await expect(done.getByText("sent to 5 sellers")).toBeVisible();
  await page.clock.pauseAt(Date.now() + 60_000);

  await done.getByRole("button", { name: "Replay payout events" }).click();
  await expect(done.getByText("Payout pending")).toHaveCount(5);
  await page.clock.runFor(600);
  await expect(paidRows).toHaveCount(1);
  await expect(paidRows.first()).toContainText("Lea Moreau");
  await page.clock.runFor(600);
  await expect(paidRows).toHaveCount(2);
  await expect(paidRows.first()).toContainText("Jun Park");
  await page.clock.runFor(3_000);
  await expect(paidRows).toHaveCount(5);
  // React renders the last row in real time after the clock stops, so the total's last frame needs one more step.
  await page.clock.runFor(100);
  await expect(done.getByText("Paid with PayPal")).toHaveCount(5);
  await expect(done.getByText("$136", { exact: true })).toBeVisible();
  await expect(done.getByText("sent to 5 sellers")).toBeVisible();
});

test("the home page does not link to the style guide", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('a[href*="style-guide"]')).toHaveCount(0);
});
