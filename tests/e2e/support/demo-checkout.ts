import { expect, type Browser, type Page } from "@playwright/test";
import { readConfig } from "@/lib/config";
import { SESSION_COOKIE, signSession } from "@/lib/session";
import { approveInPopup } from "./paypal-popup";
import { LIVE, routeRecordedPayPal } from "./sandbox";

/** Pays the five seller demo cart on Furnish, the recorded sandbox by default and the real one with ROOMOVER_E2E_LIVE=1. */
export async function payDemoCart(page: Page): Promise<void> {
  await page.goto("/furnish");
  await expect(page.locator("[data-total]")).toHaveText("$144");
  await expect(page.locator('[data-paypal-checkout="ready"]')).toBeVisible({ timeout: 30_000 });
  const popup = LIVE ? page.waitForEvent("popup") : null;
  await page.locator("paypal-button").click();
  if (popup !== null) await approveInPopup(await popup);
  await expect(page.getByText("PayPal holds your $144 until handoff")).toBeVisible({ timeout: 60_000 });
}

/** Approves the demo plan's checkout in a desktop window, since the PayPal popup is the desktop flow. */
export async function payDemoCartAtDesktop(browser: Browser, baseURL: string, session: string): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await routeRecordedPayPal(context, baseURL);
  await context.addCookies([{ name: SESSION_COOKIE, value: signSession(session, readConfig(["SESSION_SECRET"]).SESSION_SECRET), url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  await payDemoCart(page);
  await context.close();
}
