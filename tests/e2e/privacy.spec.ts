import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { latestSessionPlan } from "@/lib/db/plans";
import { agentEvents, listingDrafts, users } from "@/lib/db/schema";
import { userId } from "@/scripts/seed/people";
import { expect, test } from "./support/session";

// The recorded Harbor Hall plan places specific listings, and the Sell check signs in seeded Ava, so these take turns with the tests that buy.
test.use({ holdsCatalog: true });

/** A floor price field, or a floor tied to a dollar amount or a position against it. Furniture on the floor and the room's floor map are fine. */
const FLOOR_TALK = /floorPriceCents|floor_price|floorCents|floor (?:price )?(?:of|is|was|at) \$\d|\$\d+ (?:is|was) (?:my|the|your|a) floor|(?:under|at|above|below|over) the (?:seller'?s )?floor\b(?! lamp)|seller'?s floor (?:of|is)/i;

test("no page, plan answer, or activity line a buyer sees carries a seller's floor", async ({ page, session }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "The check reads the same server answers at every width.");
  test.setTimeout(120_000);

  await page.goto("/furnish");
  await page.getByLabel("What should your room feel like?").fill("$150, cozy, I study late");
  await page.getByRole("button", { name: "Plan my room" }).click();
  await expect(page.locator("ul[aria-live] [data-sentence]").last()).toHaveText(/^Your room is ready\./, { timeout: 90_000 });

  const plan = await latestSessionPlan(getDb(), session);
  expect(plan).not.toBeNull();
  const lines = await getDb().select({ summary: agentEvents.summary, sentence: agentEvents.sentence, detail: agentEvents.detail }).from(agentEvents).where(eq(agentEvents.planId, plan?.id ?? ""));
  expect(lines.length).toBeGreaterThan(10);
  expect(JSON.stringify(lines)).not.toMatch(FLOOR_TALK);

  for (const path of ["/", "/furnish", "/handoff", "/sell", "/style-guide", "/does-not-exist"]) {
    const html = await (await page.request.get(path)).text();
    expect(html, path).not.toMatch(FLOOR_TALK);
  }

  // The style guide's Sell sample is made up, so its "Lowest you'll take" belongs to no listing.
  await page.goto("/style-guide");
  await expect(page.locator('[data-panel="sell-panel"]').getByText("Lowest you'll take")).toBeVisible();
  await expect(page.locator('[data-panel="sell-panel"]')).toContainText("Green glass banker's lamp");
  await expect(page.locator('[data-panel="sell-panel"]')).toContainText("$13");
});

test("Sell refuses a 21st photo in one day with one sentence", async ({ page, session }) => {
  const db = getDb();
  const ava = userId("ava");
  const [before] = await db.select({ paypalAccountId: users.paypalAccountId }).from(users).where(eq(users.id, ava));
  try {
    await page.goto("/sell");
    await page.getByRole("link", { name: "Log in with PayPal" }).click();
    await expect(page.getByText("Signed in with PayPal as Ava Lindqvist")).toBeVisible();
    await db.insert(listingDrafts).values(
      Array.from({ length: 20 }, () => ({ sellerId: ava, sessionId: session, clientHash: "e2e", sampleSrc: "/sell-samples/black-rolling-cart.jpg", photoSha256: "0".repeat(64), channel3: { candidates: [], credits: 0, cached: true, latencyMs: 0, unavailable: null } })),
    );
    await page.getByRole("button", { name: "Black rolling cart" }).click();
    await expect(page.getByText("This browser started 20 Sell photos today, the most the demo allows, and it can start more after midnight UTC.")).toBeVisible();
  } finally {
    await db.update(users).set({ paypalAccountId: before.paypalAccountId }).where(eq(users.id, ava));
  }
});
