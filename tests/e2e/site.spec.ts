import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { captureFullHeight, expectNoPageScroll } from "./support/layout";

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? "test-results/screenshots";

test("an address Roomover does not serve answers 404 inside the app shell", async ({ page }, testInfo) => {
  const width = testInfo.project.name === "desktop-1440" ? 1440 : 390;
  const problems: string[] = [];
  page.on("console", (message) => {
    // The 404 answer itself is the point of this page, so only other errors count.
    if ((message.type() === "error" && !message.text().includes("404")) || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

  const response = await page.goto("/nope");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "No room at this address" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Roomover" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("link", { name: "Furnish a room" })).toHaveAttribute("href", "/furnish");
  await expect(page.getByRole("link", { name: "Sell an item" })).toHaveAttribute("href", "/sell");
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  if (width === 1440) await expectNoPageScroll(page);
  await captureFullHeight(page, `${SCREENSHOT_DIR}/not-found-${width}.png`);
  expect(problems).toEqual([]);
});

test("every page carries the Roomover icons and a social preview, with no PayPal mark", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "The head is the same at every width.");
  await page.goto("/");
  const head = page.locator("head");
  const ico = await head.locator('link[rel="icon"][type="image/x-icon"]').getAttribute("href");
  const svg = await head.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute("href");
  const apple = head.locator('link[rel="apple-touch-icon"]');
  await expect(apple).toHaveAttribute("sizes", "180x180");
  for (const [href, type] of [
    [ico, "image/x-icon"],
    [svg, "image/svg+xml"],
    [await apple.getAttribute("href"), "image/png"],
  ] as const) {
    const answer = await request.get(href ?? "");
    expect(answer.status(), href ?? "").toBe(200);
    expect(answer.headers()["content-type"]).toContain(type);
  }
  const mark = await (await request.get(svg ?? "")).text();
  // The mark is a room corner: two Paper walls, a Stone floor, and Sky only on the window.
  expect(mark.match(/fill="#F6F3EE"/g)).toHaveLength(2);
  expect(mark).toContain('fill="#8C877D"');
  expect(mark.match(/#60CDFF/g)).toHaveLength(1);

  const meta = (property: string) => head.locator(`meta[property="${property}"], meta[name="${property}"]`).first().getAttribute("content");
  expect(await meta("og:title")).toBe("Roomover. Turning move-out season into move-in opportunities.");
  expect(await meta("og:image:width")).toBe("1200");
  expect(await meta("og:image:height")).toBe("630");
  expect(await meta("twitter:card")).toBe("summary_large_image");
  for (const property of ["og:image", "twitter:image"]) {
    const image = await meta(property);
    expect(image, property).toMatch(/^https?:\/\//);
    const answer = await request.get(new URL(new URL(image ?? "").pathname + new URL(image ?? "").search, page.url()).href);
    expect(answer.status()).toBe(200);
    expect(answer.headers()["content-type"]).toContain("image/png");
  }
  expect(await meta("og:image:alt")).toContain("3D dorm room");
});
