import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { decodePng } from "./png";

const CART = ["jun-white-desk", "marcus-mesh-desk-chair", "ava-desk-lamp", "sofia-clamp-lamp", "lea-navy-bean-bag"];
const TABLE: [number, number, number] = [0xe9, 0xe6, 0xe0];

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

async function openFurnishRoom(page: Page) {
  await page.goto("/style-guide#furnish");
  const room = page.locator('[data-room="harbor-hall-double"]');
  await room.scrollIntoViewIfNeeded();
  await expect(room).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  return room;
}

/** Hue in degrees and HSL saturation of one pixel. */
function hueOf([r, g, b]: [number, number, number]): { hue: number; saturation: number } {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0 };
  const lightness = (max + min) / 2;
  const sector = max === red ? ((green - blue) / delta) % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  return { hue: (sector * 60 + 360) % 360, saturation: delta / (1 - Math.abs(2 * lightness - 1)) };
}

const listKeys = (page: Page) => page.locator("[data-room] ol [data-item]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-item")));

test("Harbor Hall 214 draws on the table color and its list mirrors the room", async ({ page }) => {
  const problems = watchConsole(page);
  const room = await openFurnishRoom(page);
  await expect(room).toHaveAttribute("data-placed", "5");
  await expect(room).toHaveAttribute("data-ring", "lea-navy-bean-bag");
  expect(await listKeys(page)).toEqual(CART);
  await expect(room.getByRole("img", { name: /Harbor Hall 214, a Harbor Hall double of 3\.6 by 4\.5 meters, with 5 of 5 items placed/ })).toBeVisible();

  const shot = decodePng(await room.getByRole("img").screenshot());
  for (const [x, y] of [[2, 2], [shot.width - 3, 2], [2, shot.height - 3]]) expect(shot.pixel(x, y)).toEqual(TABLE);
  expect(shot.pixel(Math.round(shot.width / 2), Math.round(shot.height / 2))).not.toEqual(TABLE);
  expect(problems).toEqual([]);
});

test("Play placement empties the room and lands the cart one item at a time", async ({ page }) => {
  const problems = watchConsole(page);
  const room = await openFurnishRoom(page);
  await page.getByRole("button", { name: "Play placement" }).click();
  await expect(room).toHaveAttribute("data-placed", "0");
  await expect(page.getByText("The room is empty. Items appear here as they land.")).toBeVisible();
  for (let count = 1; count <= CART.length; count++) {
    await expect(room).toHaveAttribute("data-placed", String(count));
    expect(await listKeys(page)).toEqual(CART.slice(0, count));
  }
  await expect(room).toHaveAttribute("data-ring", "lea-navy-bean-bag");
  await expect(page.getByRole("button", { name: "Play placement" })).toBeEnabled();
  expect(problems).toEqual([]);
});

test("reduced motion places each item without the drop", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const room = await openFurnishRoom(page);
  await page.getByRole("button", { name: "Play placement" }).click();
  await expect(room).toHaveAttribute("data-placed", "1");
  // With the drop, the ring waits for the landing about 760 ms later. Without it, the ring arrives with the item.
  await expect(room).toHaveAttribute("data-ring", "jun-white-desk", { timeout: 250 });
  await expect(room).toHaveAttribute("data-placed", "5");
  await expect(room).toHaveAttribute("data-ring", "lea-navy-bean-bag", { timeout: 250 });
});

test("focusing an item in the list shows its Paper tag", async ({ page }) => {
  await openFurnishRoom(page);
  await page.locator('[data-item="lea-navy-bean-bag"]').focus();
  const tag = page.locator("[data-room] [aria-hidden='true'].shadow-sheet");
  await expect(tag).toBeVisible();
  await expect(tag).toContainText("Navy bean bag chair with matching pouf");
  await expect(tag).toContainText("$30, good, from Lea Moreau");
  await page.locator('[data-item="lea-navy-bean-bag"]').blur();
  await expect(tag).toBeHidden();
});

test("without WebGL the room falls back to its list", async ({ page }) => {
  const problems = watchConsole(page);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (kind.includes("webgl")) return null;
      return (original as (...args: unknown[]) => RenderingContext | null).call(this, kind, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto("/style-guide#furnish");
  const room = page.locator('[data-room="harbor-hall-double"]');
  await expect(room.getByRole("status")).toContainText("The 3D room needs WebGL");
  expect(await listKeys(page)).toEqual(CART);
  await expect(room.locator("canvas")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Play placement" })).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("the presets page renders every preset with all 24 seed listings and passes axe", async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto("/style-guide/rooms");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  const presets = page.getByRole("group", { name: "Room preset" }).getByRole("button");
  await expect(presets).toHaveCount(3);
  const counts: Record<string, number> = {};
  for (let index = 0; index < 3; index++) {
    await presets.nth(index).click();
    await expect(presets.nth(index)).toHaveAttribute("aria-pressed", "true");
    const room = page.locator("[data-room]");
    await expect(room).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    counts[(await room.getAttribute("data-room")) ?? ""] = (await listKeys(page)).length;
  }
  expect(counts).toEqual({ "harbor-hall-double": 10, "birchwood-house-single": 5, "breakwater-apartments-bedroom": 9 });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const blocking = axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
  expect(problems).toEqual([]);
});

test("the woven baskets wear their photo's colors, pink with teal on one and green with orange on the other", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "At 390 px the room draws the baskets too small to sample their colors apart from the floor.");
  const problems = watchConsole(page);
  await page.goto("/style-guide/rooms");
  await page.getByRole("group", { name: "Room preset" }).getByRole("button").nth(2).click();
  const room = page.locator('[data-room="breakwater-apartments-bedroom"]');
  await expect(room).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  const frame = room.locator("[data-room-box]");
  const row = page.locator('[data-item="sofia-woven-baskets"]');

  // The tag sits centered 12 px above the baskets' top, which finds them on screen.
  await row.focus();
  const tag = room.locator("[data-room-tag]");
  await expect(tag).toContainText("Two woven grass baskets");
  const [box, label] = await Promise.all([frame.boundingBox(), tag.boundingBox()]);
  if (box === null || label === null) throw new Error("The room or its tag has no box.");
  await row.blur();
  await expect(tag).toBeHidden();
  await page.waitForTimeout(300);

  const shot = decodePng(await frame.screenshot({ scale: "css" }));
  const x = Math.round(label.x + label.width / 2 - box.x);
  const y = Math.round(label.y + label.height + 12 - box.y);
  const counts = { pink: 0, teal: 0, green: 0, orange: 0 };
  for (let py = Math.max(0, y); py < Math.min(shot.height, y + 110); py++) {
    for (let px = Math.max(0, x - 120); px < Math.min(shot.width, x + 120); px++) {
      const { hue, saturation } = hueOf(shot.pixel(px, py));
      if (saturation > 0.2 && (hue >= 330 || hue <= 10)) counts.pink += 1;
      else if (saturation > 0.06 && hue >= 170 && hue <= 220) counts.teal += 1;
      else if (saturation > 0.06 && hue >= 70 && hue <= 130) counts.green += 1;
      else if (saturation > 0.25 && hue >= 20 && hue <= 45) counts.orange += 1;
    }
  }
  for (const color of ["pink", "teal", "green", "orange"] as const) expect(counts[color], `${color} pixels near the baskets, ${JSON.stringify(counts)}`).toBeGreaterThan(40);
  expect(problems).toEqual([]);
});
