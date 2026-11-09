import { expect, test } from "@playwright/test";

test("home page names the product and leads to Furnish and Sell", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Roomover");
  await expect(page.getByRole("link", { name: "Roomover" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("navigation", { name: "What would you like to do" }).getByRole("link")).toHaveCount(2);

  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
});
