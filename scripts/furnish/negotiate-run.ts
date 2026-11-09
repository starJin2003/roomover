import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Cookie, type Locator, type Page } from "@playwright/test";
import { asc, desc, eq } from "drizzle-orm";
import { readConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { loadNegotiations } from "@/lib/db/negotiations";
import { currentOrder } from "@/lib/db/orders";
import { latestSessionPlan } from "@/lib/db/plans";
import { agentEvents, agentRuns, plans } from "@/lib/db/schema";
import { agentEventDetailSchema } from "@/lib/domain/agent-events";
import { paypalSdk } from "@/lib/paypal/server-sdk/client";
import { getOrder } from "@/lib/paypal/server-sdk/orders";
import { SESSION_COOKIE, signSession, verifySession } from "@/lib/session";

/**
 * Drives one plan in a real browser against a running server and records it
 * on video: the buyer agent negotiates with each seller's agent, fills a gap
 * with a new product from Channel3, and prepares the PayPal order. It takes
 * the screenshots the planning chat reviews at 1440 and 390, then reads the
 * order back from PayPal and checks that it holds the agreed prices of the
 * used items and nothing else. It prints timings, Claude calls and tokens,
 * and Channel3 credits.
 *
 *   pnpm furnish:negotiate --base http://127.0.0.1:3000 --out <folder> --room birchwood-house-single --prompt "$90, cozy, I study late"
 */

const args = new Map(process.argv.slice(2).flatMap((value, index, all) => (value.startsWith("--") ? [[value.slice(2), all[index + 1]]] : [])));
const BASE = args.get("base") ?? "http://127.0.0.1:3000";
const OUT = args.get("out") ?? "test-results/negotiate-run";
const ROOM = args.get("room") ?? "birchwood-house-single";
const PROMPT = args.get("prompt") ?? "$120, cozy, I study late";
/** Retakes the screenshots of a plan already run, from its session, without planning again. */
const PLAN = args.get("plan");
const GPU = process.platform === "darwin" ? ["--use-angle=metal", "--ignore-gpu-blocklist"] : ["--ignore-gpu-blocklist"];

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

async function sentence(panel: Locator, pattern: RegExp, timeout: number): Promise<string> {
  const found = panel.locator("[data-sentence]").filter({ hasText: pattern }).last();
  await found.waitFor({ timeout });
  return found.innerText();
}

async function scrollPanelTo(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(300);
}

/** The screenshots the planning chat reviews: sentences, the new item, and Under the hood at 1440, then the whole page at 390. */
async function takeShots(browser: Browser, page: Page, cookies: Cookie[], errors: string[]): Promise<void> {
  await page.screenshot({ path: join(OUT, "negotiation-sentences-1440.png") });

  const newRow = page.locator("[data-new-item]").first();
  const hasNewItem = (await newRow.count()) > 0;
  if (hasNewItem) {
    const list = page.getByText(/^List view/);
    if ((await list.count()) > 0 && (await list.first().isVisible())) await list.first().click();
    await newRow.hover();
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(OUT, "channel3-new-item-1440.png") });
    await page.mouse.move(10, 10);
  }

  await page.getByRole("switch", { name: "Under the hood" }).click();
  await page.waitForTimeout(400);
  await scrollPanelTo(page, "[data-under-the-hood-log]");
  await page.screenshot({ path: join(OUT, "under-the-hood-1440.png") });
  await scrollPanelTo(page, "[data-channel3-search]");
  await page.screenshot({ path: join(OUT, "under-the-hood-channel3-1440.png") });

  // Phones take whole page shots in CSS pixels, like the e2e suite, since the panel sits under the room.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.addCookies(cookies.filter((cookie) => cookie.name === SESSION_COOKIE));
  const mobile = await phone.newPage();
  await mobile.goto(`${BASE}/furnish`, { waitUntil: "networkidle" });
  await mobile.waitForSelector("[data-ready=true]");
  await mobile.waitForTimeout(2500);
  await mobile.screenshot({ path: join(OUT, "negotiation-390.png"), fullPage: true, scale: "css" });
  await mobile.locator("#furnish-panel-title").evaluate((element) => element.scrollIntoView({ block: "start" }));
  await mobile.getByRole("switch", { name: "Under the hood" }).click();
  await mobile.waitForTimeout(500);
  await mobile.screenshot({ path: join(OUT, "under-the-hood-390.png"), fullPage: true, scale: "css" });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) errors.push(`The 390 page scrolls sideways by ${overflow} px.`);
  await phone.close();

}

async function retake(planId: string) {
  const browser = await chromium.launch({ args: GPU });
  const [plan] = await getDb().select({ sessionId: plans.sessionId }).from(plans).where(eq(plans.id, planId));
  if (plan?.sessionId === null || plan === undefined) throw new Error(`No session plan ${planId}.`);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: SESSION_COOKIE, value: signSession(plan.sessionId, readConfig(["SESSION_SECRET"]).SESSION_SECRET), url: BASE, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`${BASE}/furnish`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-ready=true]");
  await page.waitForTimeout(2500);
  await takeShots(browser, page, await context.cookies(), errors);
  await browser.close();
  console.log(JSON.stringify({ planId, retaken: true, consoleErrors: errors }, null, 2));
  process.exit(0);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  if (PLAN !== undefined) return retake(PLAN);
  const browser = await chromium.launch({ args: GPU });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } });
  const page = await context.newPage();
  // The video is the run's record, so it is kept even when a later step fails.
  const saveVideo = async () => {
    const video = page.video();
    await context.close();
    if (video !== null) await rename(await video.path(), join(OUT, "run.webm"));
  };
  try {
    await record(browser, context, page, saveVideo);
  } catch (error) {
    await saveVideo().catch(() => undefined);
    throw error;
  }
}

async function record(browser: Browser, context: BrowserContext, page: Page, saveVideo: () => Promise<void>) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${BASE}/furnish`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-ready=true]");
  await page.locator(`input[name=preset][value="${ROOM}"]`).check();
  await page.getByLabel("What should your room feel like?").fill(PROMPT);
  await page.waitForTimeout(800);
  const panel = page.locator("#furnish-panel-title").locator("xpath=ancestor::section[1]");
  const started = Date.now();
  await page.getByRole("button", { name: "Plan my room" }).click();
  await page.waitForSelector('[data-placed="1"]', { timeout: 120_000 });
  const firstItemMs = Date.now() - started;
  const firstDeal = await sentence(panel, /agent (agreed|countered|kept|did not answer)/, 180_000);
  const firstDealMs = Date.now() - started;
  const finished = await sentence(panel, /^(Your room is ready|Nothing fit|The buyer agent stopped)/, 300_000);
  const totalMs = Date.now() - started;
  await page.waitForTimeout(3500);
  const cookies = await context.cookies();
  await takeShots(browser, page, cookies, errors);
  const session = verifySession(cookies.find((candidate) => candidate.name === SESSION_COOKIE)?.value, readConfig(["SESSION_SECRET"]).SESSION_SECRET);
  if (session === null) throw new Error("The run left no signed session cookie.");

  const db = getDb();
  const plan = await latestSessionPlan(db, session);
  if (plan === null) throw new Error("No plan for the session.");
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.planId, plan.id)).orderBy(desc(agentRuns.startedAt)).limit(1);
  const events = (await db.select().from(agentEvents).where(eq(agentEvents.runId, run.id)).orderBy(asc(agentEvents.seq))).map((event) => ({ ...event, detail: agentEventDetailSchema.parse(event.detail) }));
  const negotiations = await loadNegotiations(db, plan.id);
  const order = await currentOrder(db, plan.id);
  const paypal = order?.paypalOrderId ? await getOrder(paypalSdk(), order.paypalOrderId) : null;
  const paypalTotal = paypal?.purchaseUnits?.[0]?.amount?.value ?? null;
  const usedItems = plan.layout.items.flatMap((item) => (item.source === "listing" ? [item.listingId] : []));
  const agreed = new Map(negotiations.flatMap((row) => (row.status === "agreed" && row.agreedPriceCents !== null ? [[row.listingId, row.agreedPriceCents] as const] : [])));
  const sellerEvents = events.filter((event) => event.agent === "seller");
  const sellerLatency = sellerEvents.map((event) => event.detail.latencyMs ?? 0);
  await saveVideo();
  await browser.close();

  console.log(
    JSON.stringify(
      {
        planId: plan.id,
        room: ROOM,
        prompt: PROMPT,
        firstItem: seconds(firstItemMs),
        firstDeal: seconds(firstDealMs),
        firstDealSentence: firstDeal,
        planTotal: seconds(totalMs),
        finished,
        sentences: events.flatMap((event) => (event.sentence === null ? [] : [event.sentence])),
        run: {
          status: run.status,
          claudeCalls: run.claudeCalls,
          sellerAgentCalls: sellerEvents.reduce((sum, event) => sum + (event.detail.claudeCalls ?? 0), 0),
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          cacheReadTokens: run.cacheReadTokens,
          cacheWriteTokens: run.cacheWriteTokens,
          sellerCacheReadTokens: sellerEvents.reduce((sum, event) => sum + (event.detail.cacheReadTokens ?? 0), 0),
          sellerLatency: sellerLatency.map(seconds),
          firstItemAfter: run.firstItemAt === null ? null : seconds(run.firstItemAt.getTime() - run.startedAt.getTime()),
          took: run.finishedAt === null ? null : seconds(run.finishedAt.getTime() - run.startedAt.getTime()),
        },
        channel3: events
          .filter((event) => event.detail.channel3 !== undefined)
          .map((event) => ({ tool: event.tool, query: event.detail.channel3?.query, filters: event.detail.channel3?.filters, credits: event.detail.channel3?.credits, cached: event.detail.channel3?.cached, latency: seconds(event.detail.latencyMs ?? 0) })),
        negotiations: negotiations.map((row) => ({ listingId: row.listingId, status: row.status, rounds: row.offers.length, agreedPriceCents: row.agreedPriceCents, slot: row.agreedSlot?.startsAt.toISOString() ?? null })),
        newItems: plan.layout.items.flatMap((item) => (item.source === "new_product" ? [{ name: item.productName, retailer: item.retailer, priceCents: item.priceCents, buyUrl: item.buyUrl }] : [])),
        order:
          order === null
            ? null
            : {
                paypalOrderId: order.paypalOrderId,
                status: order.status,
                paymentMode: order.paymentMode,
                totalCents: order.totalCents,
                lines: order.lines.map((line) => ({ listingId: line.listingId, amountCents: line.amountCents, agreedCents: agreed.get(line.listingId) ?? null, slot: line.slot?.startsAt.toISOString() ?? null })),
                paypalTotal,
                usedItemsInPlan: usedItems.length,
                matchesAgreedUsedItems:
                  paypalTotal !== null &&
                  Math.round(Number(paypalTotal) * 100) === order.totalCents &&
                  order.lines.length === usedItems.length &&
                  order.lines.every((line) => line.amountCents === (agreed.get(line.listingId) ?? line.amountCents)),
              },
        consoleErrors: errors,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

void main();
