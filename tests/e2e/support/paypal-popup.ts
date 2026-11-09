import type { Page } from "@playwright/test";
import { readOptionalConfig } from "@/lib/config";

export const JUDGE_BUYER = "roomover-judge-jin0608@personal.example.com";
export const BUYER_PASSWORD = readOptionalConfig("PAYPAL_SANDBOX_BUYER_PASSWORD");

/** Logs the judge buyer into the sandbox popup and approves the order. */
export async function approveInPopup(popup: Page, screenshot?: string): Promise<void> {
  await popup.waitForLoadState("domcontentloaded");
  const email = popup.locator("input#email, input[name=login_email]");
  await email.waitFor({ timeout: 45_000 });
  await email.fill(JUDGE_BUYER);
  const next = popup.locator("#btnNext");
  if (await next.isVisible()) await next.click();
  const password = popup.locator("input#password, input[name=login_password]");
  await password.waitFor({ timeout: 30_000 });
  await password.fill(BUYER_PASSWORD ?? "");
  await popup.locator("#btnLogin").click();
  const complete = popup.getByTestId("submit-button-initial");
  await complete.waitFor({ timeout: 60_000 });
  await popup.waitForTimeout(1500);
  if (screenshot !== undefined) await popup.screenshot({ path: screenshot });
  await complete.click();
}
