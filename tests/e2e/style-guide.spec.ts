import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const SCREENSHOT_DIR = "local/screenshots/style-guide";

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
  await expect(page.locator("img")).toHaveCount(3);
  for (const image of await page.locator("img").all()) {
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const blocking = axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);

  await page.screenshot({ path: `${SCREENSHOT_DIR}/${testInfo.project.name}.png`, fullPage: true });
  expect(problems).toEqual([]);
});

test("the home page does not link to the style guide", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('a[href*="style-guide"]')).toHaveCount(0);
});
