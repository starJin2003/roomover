import { expect, type Page } from "@playwright/test";

/**
 * On desktop each working screen fits the viewport. Content scrolls inside
 * the panel, so the document itself never grows taller than the window.
 */
export async function expectNoPageScroll(page: Page): Promise<void> {
  const size = await page.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, innerHeight: window.innerHeight }));
  expect(size.scrollHeight, "the document scrolls vertically").toBeLessThanOrEqual(size.innerHeight);
}

/** The list under the room folds away on desktop, so keyboard moves start by opening it. */
export async function openRoomList(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: /^List view, \d+ items?$/ });
  if (await toggle.isVisible()) await toggle.click();
}

/**
 * Full page captures in CSS pixels. Phones are captured at their full height,
 * so a sticky bar sits where the sheet ends and covers nothing.
 */
export async function captureFullHeight(page: Page, path: string): Promise<void> {
  const viewport = page.viewportSize();
  const phone = viewport !== null && viewport.width < 600;
  if (phone) {
    await page.setViewportSize({ width: viewport.width, height: await page.evaluate(() => document.documentElement.scrollHeight) });
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path, fullPage: true, scale: "css" });
  if (phone) await page.setViewportSize(viewport);
}

/**
 * The no scroll check at the two desktop sizes the screens are designed for,
 * with a capture of each, then back to the project's own size.
 */
export async function expectFitsDesktops(page: Page, dir: string, name: string): Promise<void> {
  const viewport = page.viewportSize();
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(400);
    await expectNoPageScroll(page);
    await page.screenshot({ path: `${dir}/layout-${name}-${size.width}x${size.height}.png`, scale: "css" });
  }
  if (viewport !== null) await page.setViewportSize(viewport);
}
