import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Locator, type Page } from "@playwright/test";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { latestSessionPlan } from "@/lib/db/plans";
import { agentRuns } from "@/lib/db/schema";
import { itemNoun } from "@/lib/domain/room-words";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { readConfig } from "@/lib/config";

/**
 * Drives one full Furnish run in a real browser against a running server and
 * records it on video: plan, the room filling, one drag edit that passes over
 * a spot that fails before it drops on one that fits, one change asked for
 * in words, and a reload. It prints timings from the click to the first
 * sentence and the first item, token use, and whether the edits survived
 * the reload.
 *
 *   pnpm furnish:run --base http://127.0.0.1:3000 --out <folder>
 */

const args = new Map(process.argv.slice(2).flatMap((value, index, all) => (value.startsWith("--") ? [[value.slice(2), all[index + 1]]] : [])));
const BASE = args.get("base") ?? "http://127.0.0.1:3000";
const OUT = args.get("out") ?? "test-results/furnish-run";
const PROMPT = "$150, cozy, I study late";
const GPU = process.platform === "darwin" ? ["--use-angle=metal", "--ignore-gpu-blocklist"] : ["--ignore-gpu-blocklist"];
/** Screen offsets from the grab point, in rings that widen, tried until the held item sits on a spot that fits. */
const DRAG_TRIES: readonly [number, number][] = [60, 100, 140, 180, 230].flatMap((radius) =>
  Array.from({ length: 8 }, (_, step): [number, number] => [Math.round(radius * Math.cos((step * Math.PI) / 4)), Math.round(radius * Math.sin((step * Math.PI) / 4) * 0.7)]),
);

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Where an item's tag points, which is just above the item's top, in page pixels. */
async function itemAnchor(page: Page, key: string): Promise<{ x: number; y: number }> {
  await page.locator(`[data-item="${key}"]`).hover();
  const tag = page.locator("[data-room-tag]");
  await page.waitForFunction(() => document.querySelector<HTMLElement>("[data-room-tag]")?.style.visibility === "visible");
  await page.waitForTimeout(150);
  const box = await page.locator("[data-room-box]").boundingBox();
  const transform = await tag.evaluate((element) => (element as HTMLElement).style.transform);
  const size = await tag.boundingBox();
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(transform);
  if (box === null || size === null || match === null) throw new Error(`No tag anchor for ${key}.`);
  return { x: box.x + Number(match[1]) + size.width / 2, y: box.y + Number(match[2]) + size.height + 12 };
}

async function waitForSentence(panel: Locator, pattern: RegExp, timeout: number): Promise<string> {
  const sentence = panel.locator("ul[aria-live] [data-sentence]").filter({ hasText: pattern }).last();
  await sentence.waitFor({ timeout });
  return sentence.innerText();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ args: GPU });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${BASE}/furnish`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-ready=true]");
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, "plan-1440.png"), fullPage: true });

  const panel = page.locator("#furnish-panel-title").locator("xpath=ancestor::section[1]");
  await page.getByLabel("What should your room feel like?").fill(PROMPT);
  const started = Date.now();
  await page.getByRole("button", { name: "Plan my room" }).click();
  await panel.locator("ul[aria-live] [data-sentence]").first().waitFor({ timeout: 60_000 });
  const firstSentenceMs = Date.now() - started;
  await page.waitForSelector('[data-placed="1"]', { timeout: 120_000 });
  const firstItemMs = Date.now() - started;
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, "filling-1440.png"), fullPage: true });

  const finished = await waitForSentence(panel, /^(Your room is ready|Nothing fit|The buyer agent stopped)/, 240_000);
  const totalMs = Date.now() - started;
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(OUT, "ready-1440.png"), fullPage: true });

  const cookie = (await context.cookies()).find((candidate) => candidate.name === SESSION_COOKIE);
  const session = verifySession(cookie?.value, readConfig(["SESSION_SECRET"]).SESSION_SECRET);
  if (session === null) throw new Error("The run left no signed session cookie.");
  const db = getDb();
  const planned = await latestSessionPlan(db, session);
  if (planned === null) throw new Error("No plan for the session.");

  // The drag holds a floor item, passes over a spot that fails, then drops it where it fits.
  const floor = planned.layout.items.filter((item) => item.placement === "floor" && item.heightMm >= 300);
  const subject = floor.find((item) => ["bean_bag", "armchair", "pouf", "side_chair", "desk_chair"].includes(item.furnitureType)) ?? floor[0];
  let dragged = "none";
  if (subject !== undefined) {
    const anchor = await itemAnchor(page, subject.key);
    const grab = { x: anchor.x, y: anchor.y + 24 };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x - 40, grab.y, { steps: 4 });
    await page.mouse.move(grab.x - 520, grab.y + 60, { steps: 16 });
    await page.waitForTimeout(400);
    if ((await page.locator("[data-room]").getAttribute("data-invalid")) === "true") {
      await page.screenshot({ path: join(OUT, "editing-invalid-1440.png"), fullPage: true });
    }
    for (const [dx, dy] of DRAG_TRIES) {
      await page.mouse.move(grab.x + dx, grab.y + dy, { steps: 12 });
      await page.waitForTimeout(250);
      if ((await page.locator("[data-room]").getAttribute("data-invalid")) === "false") break;
    }
    await page.mouse.up();
    await page.waitForTimeout(1500);
    dragged = subject.key;
  }
  const afterDrag = await latestSessionPlan(db, session);
  const movedItem = afterDrag?.layout.items.find((item) => item.key === subject?.key);

  // A change asked for in words.
  const target = afterDrag?.layout.items.find((item) => item.key === subject?.key) ?? afterDrag?.layout.items[0];
  const request = target === undefined ? "Move one item closer to the window" : `Move the ${itemNoun(target)} next to the window`;
  await page.getByLabel("Ask the agent for a change").fill(request);
  const askedAt = Date.now();
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const edited = await waitForSentence(panel, /^(Your room is updated|The buyer agent stopped)/, 180_000);
  const editMs = Date.now() - askedAt;
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT, "edited-1440.png"), fullPage: true });

  const beforeReload = await latestSessionPlan(db, session);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("[data-ready=true]");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, "reloaded-1440.png"), fullPage: true });
  const afterReload = await latestSessionPlan(db, session);
  const shownAfterReload = Number(await page.locator("[data-room]").getAttribute("data-placed"));

  const runs = await db.select().from(agentRuns).where(eq(agentRuns.planId, planned.id)).orderBy(desc(agentRuns.startedAt));
  const video = page.video();
  await context.close();
  await browser.close();
  if (video !== null) await rename(await video.path(), join(OUT, "run.webm"));

  console.log(
    JSON.stringify(
      {
        planId: planned.id,
        firstSentence: seconds(firstSentenceMs),
        firstItem: seconds(firstItemMs),
        planTotal: seconds(totalMs),
        finished,
        items: planned.layout.items.map((item) => [item.key, item.xMm, item.yMm, item.rotationDeg]),
        dragged,
        dragFrom: subject === undefined ? null : [subject.xMm, subject.yMm],
        dragTo: movedItem === undefined ? null : [movedItem.xMm, movedItem.yMm],
        request,
        edited,
        editTotal: seconds(editMs),
        persisted: JSON.stringify(beforeReload?.layout) === JSON.stringify(afterReload?.layout) && shownAfterReload === afterReload?.layout.items.length,
        runs: runs.map((run) => ({
          kind: run.kind,
          status: run.status,
          error: run.error,
          calls: run.claudeCalls,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          cacheWriteTokens: run.cacheWriteTokens,
          cacheReadTokens: run.cacheReadTokens,
          firstItemAfter: run.firstItemAt === null ? null : seconds(run.firstItemAt.getTime() - run.startedAt.getTime()),
          took: run.finishedAt === null ? null : seconds(run.finishedAt.getTime() - run.startedAt.getTime()),
        })),
        consoleErrors: errors,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

void main();
