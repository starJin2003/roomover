import { expect, test } from "@playwright/test";

test("home page shows the name and tagline", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Roomover");
  await expect(page.getByRole("heading", { level: 1, name: "Roomover" })).toBeVisible();
  await expect(
    page.getByText("Turning move-out season into move-in opportunities."),
  ).toBeVisible();

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflows).toBe(false);

  await page.screenshot({ path: testInfo.outputPath("home.png"), fullPage: true });
});
