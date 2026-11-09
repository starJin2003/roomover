import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { readOptionalConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { agentEvents, listingDrafts, listings, plans, users } from "@/lib/db/schema";
import { SANDBOX_EMAILS, userId } from "../seed/people";

/**
 * One live Sell run, recorded on video, against a server running without
 * fixtures, so Log in with PayPal, Channel3, and Claude are all real. Seller
 * 1 (Ava) signs in on PayPal's own page, lists the black rolling cart sample
 * with the size she measured, and then a buyer plans a room that needs
 * storage, so the live buyer agent searches the catalog the listing joined.
 * It prints the payer ID field, the listing, the Channel3 match and credits,
 * the Claude usage of both agents, and the timings.
 *
 *   pnpm sell:run --base http://127.0.0.1:3000 --out <folder>
 */

const args = new Map(process.argv.slice(2).flatMap((value, index, all) => (value.startsWith("--") ? [[value.slice(2), all[index + 1]]] : [])));
const BASE = args.get("base") ?? "http://127.0.0.1:3000";
const OUT = args.get("out") ?? "test-results/sell-run";
const SELLER = SANDBOX_EMAILS.sellers[0];
const GPU = process.platform === "darwin" ? ["--use-angle=metal", "--ignore-gpu-blocklist"] : ["--ignore-gpu-blocklist"];
/** The cart's measured size in inches: 17.75 wide, 13.75 deep, 30.75 tall. */
const SIZE = { Width: "17.75", Depth: "13.75", Height: "30.75" };

const seconds = (ms: number) => Number((ms / 1000).toFixed(1));

/** PayPal's login page asks for the email, then the password, and on a first login for consent. */
async function logIn(page: Page, password: string) {
  const email = page.locator("input#email, input[name=login_email]");
  await email.waitFor({ timeout: 45_000 });
  await page.waitForTimeout(800);
  await email.fill(SELLER);
  const next = page.locator("#btnNext");
  if (await next.isVisible()) await next.click();
  const field = page.locator("input#password, input[name=login_password]");
  await field.waitFor({ timeout: 30_000 });
  await field.fill(password);
  await page.waitForTimeout(600);
  await page.locator("#btnLogin").click();
  const back = new RegExp(`^${BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/sell`);
  for (const started = Date.now(); Date.now() - started < 90_000 && !back.test(page.url()); await page.waitForTimeout(1000)) {
    const consent = page.getByRole("button", { name: /^(Agree and Connect|Agree and Continue|Continue|Allow)$/i }).first();
    if (await consent.isVisible().catch(() => false)) await consent.click();
  }
  if (!back.test(page.url())) throw new Error(`Log in with PayPal did not come back, last at ${new URL(page.url()).origin}${new URL(page.url()).pathname}.`);
}

async function main() {
  const password = readOptionalConfig("PAYPAL_SANDBOX_SELLER_PASSWORD");
  if (password === undefined) throw new Error("Set PAYPAL_SANDBOX_SELLER_PASSWORD in .env.local.");
  await mkdir(OUT, { recursive: true });
  const db = getDb();

  const browser = await chromium.launch({ args: GPU });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const timings: Record<string, number> = {};
  const started = Date.now();

  await page.goto(`${BASE}/sell`);
  await page.getByRole("link", { name: "Log in with PayPal" }).waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, "sign-in-1440.png") });
  const loginPressed = Date.now();
  await page.getByRole("link", { name: "Log in with PayPal" }).click();
  await logIn(page, password);
  await page.getByText("Signed in with PayPal as").waitFor({ timeout: 30_000 });
  timings.loginSeconds = seconds(Date.now() - loginPressed);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, "photo-1440.png") });

  const photoPressed = Date.now();
  await page.getByRole("button", { name: "Black rolling cart" }).click();
  await page.getByText(/^Channel3 (found|did not)/).first().waitFor({ timeout: 60_000 });
  timings.channel3Seconds = seconds(Date.now() - photoPressed);
  await page.getByRole("heading", { level: 1, name: "Check the details" }).waitFor({ timeout: 90_000 });
  timings.filledSeconds = seconds(Date.now() - photoPressed);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT, "details-1440.png") });
  await page.getByRole("switch", { name: "Under the hood" }).click();
  await page.getByRole("region", { name: "Under the hood" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, "details-under-the-hood-1440.png") });
  for (const [label, value] of Object.entries(SIZE)) {
    const field = page.getByLabel(label, { exact: true });
    if (await field.isVisible().catch(() => false)) await field.fill(value);
  }
  await page.waitForTimeout(1000);
  const price = (await page.locator("#sell-price").textContent()) ?? "";
  await page.getByRole("button", { name: `List for ${price}` }).click();
  await page.getByRole("heading", { level: 1, name: /^Listed for / }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT, "listed-1440.png") });

  const ava = userId("ava");
  const [seller] = await db.select({ paypalAccountId: users.paypalAccountId }).from(users).where(eq(users.id, ava));
  const [draft] = await db.select().from(listingDrafts).where(eq(listingDrafts.sellerId, ava)).orderBy(listingDrafts.createdAt).then((rows) => rows.slice(-1));
  const [listing] = await db.select().from(listings).where(eq(listings.id, draft.listingId ?? ""));

  // A buyer who needs storage plans a room, and the live buyer agent searches the catalog the listing just joined.
  await page.getByRole("link", { name: "Furnish a room as a buyer" }).click();
  await page.getByLabel("What should your room feel like?").waitFor({ timeout: 30_000 });
  await page.getByLabel("What should your room feel like?").fill("$60, I need a rolling cart for storage by my desk");
  await page.waitForTimeout(800);
  const planPressed = Date.now();
  await page.getByRole("button", { name: "Plan my room" }).click();
  await page.locator("ul[aria-live] [data-sentence]").filter({ hasText: /^Your room is ready/ }).waitFor({ timeout: 180_000 });
  timings.buyerRunSeconds = seconds(Date.now() - planPressed);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(OUT, "buyer-found-1440.png") });
  timings.totalSeconds = seconds(Date.now() - started);
  const video = page.video();
  await context.close();
  await browser.close();
  if (video !== null) await rename(await video.path(), join(OUT, "run.webm"));

  const [plan] = await db.select().from(plans).where(eq(plans.stylePrompt, "$60, I need a rolling cart for storage by my desk")).orderBy(plans.createdAt).then((rows) => rows.slice(-1));
  const searches = await db.select({ detail: agentEvents.detail, summary: agentEvents.summary }).from(agentEvents).where(and(eq(agentEvents.planId, plan.id), eq(agentEvents.tool, "search_listings")));
  const found = searches.filter((search) => search.detail.listingIds?.includes(listing.id));
  const placed = plan.layout.items.some((item) => item.source === "listing" && item.listingId === listing.id);

  console.log(
    JSON.stringify(
      {
        seller: { payerIdStored: seller.paypalAccountId !== null, payerIdLast4: seller.paypalAccountId?.slice(-4) ?? null },
        listing: { id: listing.id, title: listing.title, priceCents: listing.priceCents, floorPriceCents: listing.floorPriceCents, sizeMm: [listing.widthMm, listing.depthMm, listing.heightMm], status: listing.status, retailReference: listing.retailReference },
        channel3: { credits: draft.channel3.credits, cached: draft.channel3.cached, latencyMs: draft.channel3.latencyMs, candidates: draft.channel3.candidates.map((candidate) => [candidate.title, candidate.newPriceCents, candidate.domain]) },
        sellerAgent: { calls: draft.claudeCalls, inputTokens: draft.inputTokens, outputTokens: draft.outputTokens, describeMs: draft.describeMs, model: draft.details?.model },
        buyerSearch: { planId: plan.id, searches: searches.length, searchesThatFoundIt: found.map((search) => search.summary), placedInRoom: placed },
        timings,
        consoleErrors: errors,
      },
      null,
      1,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 500));
