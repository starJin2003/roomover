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
 * one for Jordan, opens on the whole gap with no sideways scroll, saves a
 * slot dragged inside both windows on the handoff days, keeps it after a
 * reload, snaps a slot dragged past Jordan's move in back with a sentence,
 * and moves a slot from the keyboard with the same check.
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

/** How far the timeline reaches past its frame, which is zero when the whole span fits. */
async function sidewaysOverflow(section: Locator): Promise<number> {
  return section.locator(".rv-schedule .b-timeline-sub-grid").first().evaluate((element) => element.scrollWidth - element.clientWidth);
}

async function zoomTo(section: Locator, zoom: "Whole gap" | "Handoff days"): Promise<void> {
  await section.getByRole("button", { name: zoom }).click();
  await expect(section.getByRole("button", { name: zoom })).toHaveAttribute("aria-pressed", "true");
  await expect(section.locator(".rv-schedule .b-sch-event").first()).toBeVisible();
  await section.page().waitForTimeout(400);
}

/** Scrolls the timeline sideways through the scheduler itself, as a trackpad or the scrollbar does. */
async function scrollTimeline(section: Locator, by: number): Promise<void> {
  await section.locator(".rv-schedule .b-sch-event").first().evaluate((element, distance) => {
    const scheduler = (globalThis as unknown as BryntumGlobal).bryntum.fromElement(element, "scheduler");
    scheduler.scrollLeft += distance;
  }, by);
  await section.page().waitForTimeout(400);
}

/** A schedule row whose name cell sits wholly inside the schedule's visible rows, with no scrolling inside the schedule. */
async function expectRowShown(section: Locator, name: string): Promise<void> {
  const row = section.locator(".rv-who-name", { hasText: new RegExp(`^${name}`) }).first();
  const body = section.locator(".rv-schedule .b-grid-body-container").first();
  const [rowBox, bodyBox] = [await row.boundingBox(), await body.boundingBox()];
  expect(rowBox, `${name}'s row`).not.toBeNull();
  expect(bodyBox, "the schedule body").not.toBeNull();
  if (rowBox === null || bodyBox === null) return;
  expect(rowBox.y).toBeGreaterThanOrEqual(bodyBox.y - 1);
  expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(bodyBox.y + bodyBox.height + 1);
  expect(await body.evaluate((element) => element.scrollTop)).toBe(0);
}

/** Drags Jun's slot along his row to a tick, taking a capture on the way when asked. */
const junKey = (section: Locator) => section.locator('.b-sch-event-wrap[aria-label^="Handoff with Jun,"] .b-sch-event');
const junWrap = (section: Locator) => section.locator('.b-sch-event-wrap[aria-label^="Handoff with Jun,"]');

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

  // Jordan's row leads, since every handoff is read against the move in.
  await expect(section.locator(".rv-who-name")).toHaveText(desktop ? ["Jordan", "Jun Park", "Marcus Bell", "Ava Lindqvist", "Sofia Navarro", "Lea Moreau"] : ["Jordan", "Jun", "Marcus", "Ava", "Sofia", "Lea"]);
  await expect(section.locator(".rv-who-detail")).toHaveText(["moves in", "desk", "chair", "lamp", "clamp lamp", "bean bag"]);
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
  await expect(section.locator("[data-schedule-message]")).toHaveText("Drag a handoff to another time while Jordan is on campus, or use the arrow keys on one. Moving one changes no payment.");
  // The schedule opens on the whole gap, from the first move out to the end of move in, with nothing past the frame.
  await expect(section.getByRole("button", { name: "Whole gap" })).toHaveAttribute("aria-pressed", "true");
  expect(await sidewaysOverflow(section)).toBeLessThanOrEqual(1);
  // The page never grows sideways either, so a phone never zooms out.
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

  await page.screenshot({ path: `${SCREENSHOT_DIR}/schedule-gap-${width}.png`, scale: "css" });
  await expectAccessible(page);
  await expectFitsDesktops(page, SCREENSHOT_DIR, "handoff-schedule");
  // At 1440 by 900 the room keeps its place above the open schedule, label and all.
  await expect(page.locator("[data-handoff-room]")).toBeVisible();
  expect((await page.locator("[data-handoff-room]").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(200);
  await expectRowShown(section, "Jordan");
  // At 1280 by 720 the room and its label step aside while the schedule is open, Jordan's row shows without scrolling the schedule, and the whole gap still fits.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(600);
  await expect(page.locator("[data-handoff-room]")).toBeHidden();
  await expect(page.getByText(/^Next, desk from Jun$/)).toBeHidden();
  await expectRowShown(section, "Jordan");
  await expectRowShown(section, "Lea");
  expect(await sidewaysOverflow(section)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/layout-handoff-schedule-open-1280x720.png`, scale: "css" });
  // Folding the schedule brings the room back.
  await page.locator("summary", { hasText: /^Schedule$/ }).click();
  await expect(page.locator("[data-handoff-room]")).toBeVisible();
  await page.locator("summary", { hasText: /^Schedule$/ }).click();
  await expect(section.locator(".rv-schedule .b-sch-event").first()).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(600);

  // The handoff days show two hour ticks and scroll inside the frame.
  await zoomTo(section, "Handoff days");
  expect(await sidewaysOverflow(section)).toBeGreaterThan(0);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/schedule-open-${width}.png`, scale: "css" });

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
  await zoomTo(reopened, "Handoff days");

  // Past Jordan's last move in hour, the slot goes back where it was with a sentence, and nothing is saved.
  const lastDay = dayHeadings[junDay + 2];
  await scrollTimeline(reopened, 200);
  await dragJun(page, reopened, lastDay, "6 PM", `${SCREENSHOT_DIR}/schedule-drag-refused-${width}.png`);
  await expect(reopened.locator("[data-schedule-message]")).toHaveText(new RegExp(`^Jordan's move in ends ${lastDay}, 6 PM, so the handoff cannot be later\\.$`));
  await expect(junKey(reopened)).toHaveText("10 AM");
  expect(formatSlot(await junSlot(planId))).toBe(formatSlot(moved));
  expect(saves).toBe(1);

  // From the keyboard in the whole gap: an odd hour is refused with the drag's sentence, Escape puts the slot back.
  await zoomTo(reopened, "Whole gap");
  const message = reopened.locator("[data-schedule-message]");
  await junWrap(reopened).focus();
  await page.keyboard.press("ArrowRight");
  await expect(message).toHaveText(`Jun's handoff, ${dayHeadings[junDay + 1]}, 11 AM to 1 PM. Handoffs take two hours and start at 10 AM, noon, 2 PM, 4 PM, or 6 PM.`);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/schedule-keys-refused-${width}.png`, scale: "css" });
  await page.keyboard.press("Escape");
  await expect(message).toHaveText(`Jun's handoff stays at ${formatSlot(moved)}.`);
  expect(saves).toBe(1);

  // Two hours later is a slot hour, so Enter saves it, and the focused slot carries its new time.
  await junWrap(reopened).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(message).toHaveText(`Jun's handoff, ${dayHeadings[junDay + 1]}, noon to 2 PM. Press Enter to save or Escape to cancel.`);
  // The key eases back from Brick, so the capture waits for it.
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/schedule-keys-${width}.png`, scale: "css" });
  const keyed = page.waitForResponse((response) => response.url().endsWith(`/api/handoff/${planId}/slots`));
  await page.keyboard.press("Enter");
  expect((await keyed).status()).toBe(200);
  await expect(message).toHaveText(`Moved Jun's handoff to ${dayHeadings[junDay + 1]}, noon to 2 PM.`);
  expect(formatSlot(await junSlot(planId))).toBe(`${dayHeadings[junDay + 1]}, noon to 2 PM`);
  await expect(junWrap(reopened)).toHaveAttribute("aria-label", new RegExp(`^Handoff with Jun, ${dayHeadings[junDay + 1]}, noon to 2 PM`));
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")).toMatch(/^Handoff with Jun, /);
  expect(saves).toBe(2);
  expect(problems).toEqual([]);
});
