import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium, type Browser, type Page } from "@playwright/test";

/**
 * Measures the 3D room during the placement demo and captures review media.
 * Run it against a production server:
 *
 *   pnpm build && pnpm start --port 3100
 *   pnpm room:benchmark --base http://localhost:3100 --out <folder>
 *
 * Frame times come from requestAnimationFrame while the placement plays, when
 * the canvas renders every frame. CPU throttling uses the DevTools protocol.
 */

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index].replace(/^--/, ""), process.argv[index + 1]);
const base = args.get("base") ?? "http://localhost:3100";
const out = args.get("out") ?? "test-results/room";
const gpuArgs = process.platform === "darwin" ? ["--use-angle=metal", "--ignore-gpu-blocklist"] : ["--ignore-gpu-blocklist"];

interface Profile {
  name: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  mobile: boolean;
  cpuThrottle: number;
}

const PROFILES: Profile[] = [
  { name: "desktop 1440, no throttle", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, mobile: false, cpuThrottle: 1 },
  { name: "desktop 1440, CPU 4x slower", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, mobile: false, cpuThrottle: 4 },
  { name: "phone 390 at 2x, CPU 4x slower", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, mobile: true, cpuThrottle: 4 },
];

async function openRoom(page: Page, path = "/style-guide#furnish") {
  await page.goto(`${base}${path}`);
  const room = page.locator("[data-room]");
  await room.scrollIntoViewIfNeeded();
  await page.waitForSelector('[data-room][data-ready="true"]', { timeout: 60_000 });
  return room;
}

async function measure(browser: Browser, profile: Profile) {
  const context = await browser.newContext({ viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor, isMobile: profile.mobile, hasTouch: profile.mobile });
  const page = await context.newPage();
  await openRoom(page);
  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  });
  const cdp = await context.newCDPSession(page);
  const busy = () => page.evaluate("(() => { const start = performance.now(); let x = 0; for (let i = 0; i < 3e7; i++) x += i % 7; return performance.now() - start; })()") as Promise<number>;
  const before = await busy();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuThrottle });
  const throttledBy = Number(((await busy()) / before).toFixed(1));
  await page.waitForTimeout(500);

  // A string, because the script runner wraps named functions in a helper the page does not have.
  await page.evaluate(`
    window.roomFrames = [];
    requestAnimationFrame(function tick(time) {
      window.roomFrames.push(time);
      requestAnimationFrame(tick);
    });
  `);
  await page.getByRole("button", { name: "Play placement" }).click();
  await page.waitForFunction(() => document.querySelector("[data-room]")?.getAttribute("data-placed") === "5", null, { timeout: 60_000 });
  await page.getByRole("button", { name: "Play placement" }).waitFor({ state: "visible", timeout: 60_000 });
  const frames = await page.evaluate(() => (window as unknown as { roomFrames: number[] }).roomFrames.slice());
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await context.close();

  const intervals = frames.slice(1).map((time, index) => time - frames[index]);
  const seconds = (frames[frames.length - 1] - frames[0]) / 1000;
  const sorted = [...intervals].sort((a, b) => a - b);
  let worstWindow = Infinity;
  for (let start = 0; start < frames.length; start++) {
    const end = frames.findIndex((time) => time >= frames[start] + 1000);
    if (end < 0) break;
    worstWindow = Math.min(worstWindow, end - start);
  }
  return {
    profile: profile.name,
    renderer,
    measuredSlowdown: throttledBy,
    seconds: Number(seconds.toFixed(2)),
    frames: frames.length,
    averageFps: Number(((frames.length - 1) / seconds).toFixed(1)),
    worstSecondFps: worstWindow,
    p95FrameMs: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(1)),
    framesOver50Ms: intervals.filter((interval) => interval > 50).length,
  };
}

async function capture(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const chunks: { url: string; bytes: number; gzip: number }[] = [];
  page.on("response", async (response) => {
    if (!response.url().endsWith(".js")) return;
    const body = await response.body().catch(() => Buffer.alloc(0));
    chunks.push({ url: new URL(response.url()).pathname, bytes: body.length, gzip: gzipSync(body).length });
  });
  await page.goto(`${base}/style-guide#furnish`, { waitUntil: "load" });
  // Chunks that arrive after load belong to the room, which the page imports on the client only.
  const initial = new Set(chunks.map((chunk) => chunk.url));
  const room = page.locator("[data-room]");
  await room.scrollIntoViewIfNeeded();
  await page.waitForSelector('[data-room][data-ready="true"]', { timeout: 60_000 });
  await page.waitForTimeout(800);
  const section = page.locator("#furnish");
  await section.screenshot({ path: join(out, "harbor-hall-214-furnished.png") });
  await page.getByRole("button", { name: "Play placement" }).click();
  await page.waitForFunction(() => document.querySelector("[data-room]")?.getAttribute("data-placed") === "0");
  await page.waitForTimeout(250);
  await section.screenshot({ path: join(out, "harbor-hall-214-empty.png") });
  await page.waitForFunction(() => document.querySelector("[data-room]")?.getAttribute("data-placed") === "5", null, { timeout: 60_000 });

  const roomChunks = new Set(chunks.map((chunk) => chunk.url).filter((url) => !initial.has(url)));

  await page.goto(`${base}/style-guide/rooms`);
  const presets = page.getByRole("group", { name: "Room preset" }).getByRole("button");
  for (let index = 0; index < (await presets.count()); index++) {
    await presets.nth(index).click();
    await page.waitForSelector('[data-room][data-ready="true"]', { timeout: 60_000 });
    await page.waitForTimeout(800);
    const slug = await page.locator("[data-room]").getAttribute("data-room");
    await page.locator("[data-room]").screenshot({ path: join(out, `preset-${slug}.png`) });
  }
  await context.close();

  const unique = [...new Map(chunks.map((chunk) => [chunk.url, chunk])).values()];
  const lazy = unique.filter((chunk) => roomChunks.has(chunk.url));
  const sum = (list: typeof chunks, key: "bytes" | "gzip") => list.reduce((total, chunk) => total + chunk[key], 0);
  const first = unique.filter((chunk) => initial.has(chunk.url));
  return {
    firstLoadJs: { files: first.length, bytes: sum(first, "bytes"), gzip: sum(first, "gzip") },
    roomChunks: { files: lazy.length, bytes: sum(lazy, "bytes"), gzip: sum(lazy, "gzip") },
  };
}

async function video(browser: Browser) {
  const folder = join(out, "video");
  await rm(folder, { recursive: true, force: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: folder, size: { width: 1440, height: 900 } } });
  const page = await context.newPage();
  await page.goto(`${base}/style-guide#furnish`);
  await page.locator("#furnish").evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.waitForSelector('[data-room][data-ready="true"]', { timeout: 60_000 });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Play placement" }).click();
  await page.waitForFunction(() => document.querySelector("[data-room]")?.getAttribute("data-placed") === "5", null, { timeout: 60_000 });
  await page.waitForTimeout(1800);
  const recording = page.video();
  await context.close();
  const path = await recording?.path();
  if (path) await rename(path, join(out, "placement.webm"));
  await rm(folder, { recursive: true, force: true });
}

async function main() {
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: gpuArgs });
  try {
    const results = [];
    for (const profile of PROFILES) results.push(await measure(browser, profile));
    const bundle = await capture(browser);
    await video(browser);
    console.log(JSON.stringify({ results, bundle }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
