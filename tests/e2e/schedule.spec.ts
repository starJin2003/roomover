import AxeBuilder from "@axe-core/playwright";
import { and, eq } from "drizzle-orm";
import type { Locator, Page } from "@playwright/test";
import { getDb } from "@/lib/db/client";
import { agentEvents, handoffs, orderItems, orders } from "@/lib/db/schema";
import { formatSlot } from "@/lib/domain/handoff-slots";
import { createDemoPlan } from "@/scripts/handoff/demo-plan";
import { HARBOR_214_DEMO_LAYOUT } from "@/scripts/seed/layouts";
import { payDemoCart, payDemoCartAtDesktop } from "./support/demo-checkout";
import { expectFitsDesktops } from "./support/layout";
import { BUYER_PASSWORD } from "./support/paypal-popup";
import { LIVE } from "./support/sandbox";
import { expect, test } from "./support/session";

test.use({ holdsCatalog: true });

/**
 * The Bryntum schedule on Handoff for the five seller demo cart, whose items
 * carry agreed slots. It loads only when opened, shows a row per seller and
 * one for Jordan, saves a slot dragged inside both windows, keeps it after a
 * reload, and snaps a slot dragged past Jordan's move in back with a sentence.
 */

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? "test-results/screenshots";
const JUN_DESK = HARBOR_214_DEMO_LAYOUT.items.find((item) => item.key === "jun-white-desk");

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const blocking = axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
}

async function openSchedule(page: Page, desktop: boolean): Promise<Locator> {
  if (desktop) await page.locator("summary", { hasText: /^Schedule$/ }).click();
  const section = page.locator("[data-schedule]:visible");
  await section.scrollIntoViewIfNeeded();
  await expect(section.locator(".rv-schedule .b-sch-event").first()).toBeVisible({ timeout: 30_000 });
  return section;
}

/** The middle of an hour tick under a day heading, read from the schedule's own headers. */
async function tick(section: Locator, day: string, hour: string): Promise<{ x: number }> {
  const days = section.locator(".b-sch-header-row-0 .b-sch-header-time-axis-cell");
  const dayBox = await days.filter({ hasText: day }).first().boundingBox();
  const timeline = await section.locator(".b-timeline-sub-grid").first().boundingBox();
  if (dayBox === null || timeline === null) throw new Error(`No heading for ${day}.`);
  for (const cell of await section.locator(".b-sch-header-row-1 .b-sch-header-time-axis-cell").all()) {
    const box = await cell.boundingBox();
    if (box === null) continue;
    const middle = box.x + box.width / 2;
    const shown = middle > timeline.x && middle < timeline.x + timeline.width;
    if (shown && middle > dayBox.x && middle < dayBox.x + dayBox.width && (await cell.innerText()).trim() === hour) return { x: middle };
  }
  throw new Error(`No ${hour} tick on ${day}.`);
}

type BryntumGlobal = { bryntum: { fromElement(element: Element, type: string): { scrollLeft: number } } };

/** Scrolls the timeline sideways through the scheduler itself, as a trackpad or the scrollbar does. */
async function scrollTimeline(section: Locator, by: number): Promise<void> {
  await section.locator(".rv-schedule .b-sch-event").first().evaluate((element, distance) => {
    const scheduler = (globalThis as unknown as BryntumGlobal).bryntum.fromElement(element, "scheduler");
    scheduler.scrollLeft += distance;
  }, by);
  await section.page().waitForTimeout(400);
}

/** Drags Jun's slot along his row to a tick, taking a capture on the way when asked. */
const junKey = (section: Locator) => section.locator('.b-sch-event-wrap[aria-label^="Handoff with Jun,"] .b-sch-event');

async function dragJun(page: Page, section: Locator, day: string, hour: string, capture?: string): Promise<void> {
  const slot = junKey(section);
  const timeline = await section.locator(".b-timeline-sub-grid").first().boundingBox();
  if (timeline === null) throw new Error("The timeline has no box.");
  // Both ends of the drag sit away from the timeline's edges, where Bryntum scrolls on its own while dragging.
  const before = await slot.boundingBox();
  if (before === null) throw new Error("Jun's slot is not on screen.");
  const shift = (before.x + before.width / 2 + (await tick(section, day, hour)).x) / 2 - (timeline.x + timeline.width / 2);
  if (Math.abs(shift) > 24) await scrollTimeline(section, shift);
  const from = await slot.boundingBox();
  if (from === null) throw new Error("Jun's slot is not on screen.");
  const target = await tick(section, day, hour);
  const y = from.y + from.height / 2;
  const startX = from.x + from.width / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) await page.mouse.move(startX + ((target.x - startX) * step) / 10, y, { steps: 3 });
  await page.waitForTimeout(300);
  if (capture !== undefined) await page.screenshot({ path: capture, scale: "css" });
  await page.mouse.up();
}

async function junSlot(planId: string): Promise<{ startsAt: Date; endsAt: Date }> {
  const [row] = await getDb()
    .select({ startsAt: handoffs.slotStartsAt, endsAt: handoffs.slotEndsAt })
    .from(handoffs)
    .innerJoin(orderItems, eq(handoffs.orderItemId, orderItems.id))
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(eq(orders.planId, planId), eq(orderItems.listingId, JUN_DESK?.source === "listing" ? JUN_DESK.listingId : "")));
  return row;
}

test("the schedule shows each seller and Jordan, saves a valid drag, and snaps an invalid one back", async ({ page, session, browser, baseURL }, testInfo) => {
  test.skip(LIVE && BUYER_PASSWORD === undefined, "A live run needs PAYPAL_SANDBOX_BUYER_PASSWORD in .env.local.");
  test.setTimeout(240_000);
  const desktop = testInfo.project.name === "desktop-1440";
  const width = desktop ? 1440 : 390;
  const problems = watchConsole(page);
  const planId = await createDemoPlan(getDb(), session);
  if (desktop) await payDemoCart(page);
  else await payDemoCartAtDesktop(browser, baseURL ?? "", session);

  await page.goto(`/handoff/${planId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Handoff" })).toBeVisible();
  // The scheduler's code arrives only when the section opens or scrolls near, so it never slows the first paint.
  expect(await page.evaluate("typeof globalThis.bryntum")).toBe("undefined");
  const section = await openSchedule(page, desktop);
  expect(await page.evaluate("typeof globalThis.bryntum")).toBe("object");

  await expect(section.locator(".rv-who-name")).toHaveText(desktop ? ["Jun Park", "Marcus Bell", "Ava Lindqvist", "Sofia Navarro", "Lea Moreau", "Jordan"] : ["Jun", "Marcus", "Ava", "Sofia", "Lea", "Jordan"]);
  await expect(section.locator(".rv-who-detail")).toHaveText(["desk", "chair", "lamp", "clamp lamp", "bean bag", "moves in"]);
  const day = String.raw`\w{3}, \w{3} \d{1,2}`;
  const slots = section.getByRole("list", { name: "Handoff slots" }).getByRole("listitem");
  await expect(slots).toHaveText([
    new RegExp(`^Jun's desk, ${day}, 2 to 4 PM$`),
    new RegExp(`^Marcus's chair, ${day}, 4 to 6 PM$`),
    new RegExp(`^Ava's lamp, ${day}, noon to 2 PM$`),
    new RegExp(`^Sofia's clamp lamp, ${day}, 10 AM to noon$`),
    new RegExp(`^Lea's bean bag, ${day}, noon to 2 PM$`),
  ]);
  await expect(section.getByText(new RegExp(`^Sofia and Lea leave by ${day}, \\d+ days before Jordan arrives, so Roomover keeps their items in Harbor Hall 214 until the handoff\\.$`))).toBeVisible();
  await expect(section.locator(".b-sch-resource-time-range.rv-range-room")).toHaveCount(2);
  await expect(section.locator(".b-sch-resource-time-range.rv-range-move_in")).toHaveCount(1);
  await expect(section.locator("[data-schedule-message]")).toHaveText("Drag a handoff to another time while Jordan is on campus. Moving one changes no payment.");
  // The timeline scrolls inside its frame, so the page never grows sideways and a phone never zooms out.
  expect(await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")).toBeLessThanOrEqual(0);
  await page.waitForTimeout(600);

  if (!desktop) {
    await section.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/schedule-${width}.png`, scale: "css" });
    await section.screenshot({ path: `${SCREENSHOT_DIR}/schedule-section-${width}.png`, scale: "css" });
    await expectAccessible(page);
    expect(problems).toEqual([]);
    return;
  }

  await page.screenshot({ path: `${SCREENSHOT_DIR}/schedule-open-${width}.png`, scale: "css" });
  await expectAccessible(page);
  await expectFitsDesktops(page, SCREENSHOT_DIR, "handoff-schedule");

  const before = await junSlot(planId);
  const dayHeadings = (await section.locator(".b-sch-header-row-0 .b-sch-header-time-axis-cell").allInnerTexts()).map((text) => text.trim());
  const junDay = dayHeadings.findIndex((text) => formatSlot(before).startsWith(text));
  expect(junDay).toBeGreaterThanOrEqual(0);
  let saves = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith(`/api/handoff/${planId}/slots`)) saves += 1;
  });

  // A slot dragged to 10 AM the next day stays inside Jun's move out and Jordan's move in, so it saves and says so.
  const saved = page.waitForResponse((response) => response.url().endsWith(`/api/handoff/${planId}/slots`));
  await dragJun(page, section, dayHeadings[junDay + 1], "10 AM", `${SCREENSHOT_DIR}/schedule-drag-${width}.png`);
  expect((await saved).status()).toBe(200);
  const moved = await junSlot(planId);
  expect(formatSlot(moved)).toBe(`${dayHeadings[junDay + 1]}, 10 AM to noon`);
  await expect(section.locator("[data-schedule-message]")).toHaveText(`Moved Jun's handoff to ${formatSlot(moved)}.`);
  await expect(slots.first()).toHaveText(`Jun's desk, ${formatSlot(moved)}`);
  const lines = await getDb().select({ sentence: agentEvents.sentence }).from(agentEvents).where(and(eq(agentEvents.planId, planId), eq(agentEvents.tool, "move_slot")));
  expect(lines.map((line) => line.sentence)).toEqual([`Moved Jun's handoff to ${formatSlot(moved)}.`]);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/schedule-moved-${width}.png`, scale: "css" });

  // The move survives a reload.
  await page.reload();
  const reopened = await openSchedule(page, desktop);
  await expect(reopened.getByRole("list", { name: "Handoff slots" }).getByRole("listitem").first()).toHaveText(`Jun's desk, ${formatSlot(moved)}`);
  await expect(junKey(reopened)).toHaveText("10 AM");

  // Past Jordan's last move in hour, the slot goes back where it was with a sentence, and nothing is saved.
  const lastDay = dayHeadings[junDay + 2];
  await scrollTimeline(reopened, 200);
  await dragJun(page, reopened, lastDay, "6 PM", `${SCREENSHOT_DIR}/schedule-drag-refused-${width}.png`);
  await expect(reopened.locator("[data-schedule-message]")).toHaveText(new RegExp(`^Jordan's move in ends ${lastDay}, 6 PM, so the handoff cannot be later\\.$`));
  await expect(junKey(reopened)).toHaveText("10 AM");
  expect(formatSlot(await junSlot(planId))).toBe(formatSlot(moved));
  expect(saves).toBe(1);
  expect(problems).toEqual([]);
});
