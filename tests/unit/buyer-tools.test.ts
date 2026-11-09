import { describe, expect, it } from "vitest";
import type { BuyerContext } from "@/lib/agents/buyer/context";
import { FLOOR_MAP_CELL_MM } from "@/lib/agents/buyer/floor-map";
import { BUYER_TOOLS, toolByName, type ToolOutcome } from "@/lib/agents/buyer/tools";
import { checkLayout } from "@/lib/domain/fit";
import { harborContext, listingId } from "./support/buyer-context";

const DESK = listingId("jun-white-desk");
const LAMP = listingId("ava-desk-lamp");
const HALOGEN = listingId("marcus-green-floor-lamp");
const BEAN_BAG = listingId("lea-navy-bean-bag");
const RUG = listingId("ava-floral-area-rug");
const FRIDGE = listingId("jun-compact-fridge");
const TABLE = listingId("marcus-oak-writing-table");

function run(context: BuyerContext, name: string, input: unknown): ToolOutcome {
  const tool = toolByName(name);
  if (tool === undefined) throw new Error(`No tool ${name}.`);
  const outcome = tool.run(context, tool.input.parse(input));
  if (outcome.layout !== undefined) context.layout = outcome.layout;
  return outcome;
}

const result = <T>(outcome: ToolOutcome) => outcome.result as T;

describe("buyer tools", () => {
  it("exposes the six tools with strict input schemas", () => {
    expect(BUYER_TOOLS.map((tool) => tool.name)).toEqual(["get_room_preset", "get_hall_rules", "search_listings", "check_fit", "place_item", "remove_item"]);
    expect(toolByName("place_item")?.input.safeParse({ listingId: DESK, xMm: 1800, yMm: 600, rotationDeg: 45, reason: "x" }).success).toBe(false);
    expect(toolByName("place_item")?.input.safeParse({ listingId: DESK, xMm: 1800, yMm: 600, rotationDeg: 0, reason: "x", extra: 1 }).success).toBe(false);
  });
});

describe("get_room_preset", () => {
  it("returns the room, its openings and fixtures, a floor map, and the budget", () => {
    const context = harborContext();
    const room = result<{ widthMm: number; doors: unknown[]; windows: unknown[]; fixtures: { label: string }[]; floorMap: string[]; remainingCents: number; egressPathMm: number }>(run(context, "get_room_preset", {}));
    expect(room.widthMm).toBe(3600);
    expect(room.doors).toHaveLength(1);
    expect(room.windows).toHaveLength(3);
    expect(room.fixtures.map((fixture) => fixture.label)).toContain("West bed");
    expect(room.floorMap).toHaveLength(Math.ceil(4500 / FLOOR_MAP_CELL_MM));
    expect(room.floorMap[0]).toHaveLength(Math.ceil(3600 / FLOOR_MAP_CELL_MM));
    expect(room.floorMap.join("")).toMatch(/B/);
    expect(room.floorMap.join("")).toMatch(/d/);
    expect(room.remainingCents).toBe(15_000);
    expect(room.egressPathMm).toBe(915);
  });
});

describe("get_hall_rules", () => {
  it("lists every constraint by section and logs one line", () => {
    const outcome = run(harborContext(), "get_hall_rules", {});
    const rules = result<{ rules: { section: string }[] }>(outcome).rules;
    expect(rules.map((rule) => rule.section)).toEqual(expect.arrayContaining(["1.1", "1.2", "2.2"]));
    expect(outcome.events).toHaveLength(1);
    expect(outcome.events[0].sentence).toBeUndefined();
  });
});

describe("search_listings", () => {
  it("filters by category and price, best matches first", () => {
    const lamps = result<{ results: { category: string; priceCents: number }[] }>(run(harborContext(), "search_listings", { category: "lamp", maxPriceCents: 1600 }));
    expect(lamps.results.length).toBeGreaterThan(0);
    expect(lamps.results.every((listing) => listing.category === "lamp" && listing.priceCents <= 1600)).toBe(true);
  });

  it("flags a listing that breaks a hall rule and says so once", () => {
    const context = harborContext();
    const first = run(context, "search_listings", { query: "floor lamp" });
    const halogen = result<{ results: { listingId: string; breaksHallRule?: string }[] }>(first).results.find((listing) => listing.listingId === HALOGEN);
    expect(halogen?.breaksHallRule).toMatch(/^Harbor Hall rule 1\.1\. Halogen lamps and bulbs are prohibited\.$/);
    expect(first.events.filter((event) => event.blocked)).toEqual([
      expect.objectContaining({ sentence: "Skipped a floor lamp from Marcus because of Harbor Hall rule 1.1. Halogen lamps and bulbs are prohibited." }),
    ]);
    expect(run(context, "search_listings", { query: "floor lamp" }).events.filter((event) => event.blocked)).toEqual([]);
  });

  it("leaves out listings already in the plan", () => {
    const context = harborContext();
    run(context, "place_item", { listingId: DESK, xMm: 1800, yMm: 600, rotationDeg: 0, reason: "Desk under the window." });
    const desks = result<{ results: { listingId: string }[] }>(run(context, "search_listings", { category: "desk" }));
    expect(desks.results.map((listing) => listing.listingId)).not.toContain(DESK);
  });
});

describe("check_fit", () => {
  it("reports a fitting spot with its elevation and changes nothing", () => {
    const context = harborContext();
    const check = result<{ fits: boolean; elevationMm: number }>(run(context, "check_fit", { listingId: LAMP, xMm: 534, yMm: 300, rotationDeg: 0 }));
    expect(check).toMatchObject({ fits: true, elevationMm: 762 });
    expect(context.layout.items).toEqual([]);
  });

  it("lists every problem at a failing spot", () => {
    const check = result<{ fits: boolean; problems: string[] }>(run(harborContext(), "check_fit", { listingId: BEAN_BAG, xMm: 457, yMm: 2874, rotationDeg: 0 }));
    expect(check.fits).toBe(false);
    expect(check.problems.join(" ")).toMatch(/overlaps the west bed/);
  });
});

describe("place_item", () => {
  it("places a listing, settles a lamp on the desk under it, and tells the story", () => {
    const context = harborContext();
    const desk = run(context, "place_item", { listingId: DESK, xMm: 1800, yMm: 600, rotationDeg: 0, reason: "Desk under the window." });
    expect(result<{ placed: boolean; spentCents: number }>(desk)).toMatchObject({ placed: true, spentCents: 5_500 });
    expect(desk.events[0].sentence).toBe("Found a desk that fits under the window. $55 from Jun.");
    const lamp = run(context, "place_item", { listingId: LAMP, xMm: 2150, yMm: 480, rotationDeg: 0, reason: "Light for late study." });
    expect(result<{ standsOn: string; elevationMm: number }>(lamp)).toMatchObject({ standsOn: "white-three-drawer-desk-with-oak-legs", elevationMm: 750 });
    expect(lamp.events[0].sentence).toBe("Found a desk lamp that fits on the desk. $16 from Ava.");
    expect(checkLayout(context.room, context.layout).problems).toEqual([]);
  });

  it("refuses a listing over the budget left", () => {
    const context = harborContext({ budgetCents: 10_000 });
    const outcome = run(context, "place_item", { listingId: TABLE, xMm: 1800, yMm: 700, rotationDeg: 0, reason: "A real desk." });
    expect(result<{ placed: boolean; problems: string[] }>(outcome).problems).toContain("It costs $180 and $100 of the $100 budget is left.");
    expect(outcome.events[0].blocked).toBe(true);
    expect(outcome.events[0].sentence).toBeUndefined();
    expect(context.layout.items).toEqual([]);
  });

  it("refuses a listing that breaks a hall rule", () => {
    const context = harborContext();
    const outcome = run(context, "place_item", { listingId: HALOGEN, xMm: 1800, yMm: 2000, rotationDeg: 0, reason: "Reading light." });
    expect(result<{ problems: string[] }>(outcome).problems).toContain("Harbor Hall rule 1.1. Halogen lamps and bulbs are prohibited.");
    expect(context.layout.items).toEqual([]);
  });

  it("refuses a spot that fails the fit check", () => {
    const context = harborContext();
    const outcome = run(context, "place_item", { listingId: BEAN_BAG, xMm: 1800, yMm: 4300, rotationDeg: 0, reason: "By the door." });
    expect(result<{ placed: boolean; problems: string[] }>(outcome).problems.join(" ")).toMatch(/blocks the swing of the south door/);
    expect(context.layout.items).toEqual([]);
  });

  it("refuses a spot that closes the path from a bed to the door", () => {
    const context = harborContext();
    // The rug lies under everything, so only the bean bag between the beds matters.
    run(context, "place_item", { listingId: RUG, xMm: 1800, yMm: 2700, rotationDeg: 0, reason: "Soft floor." });
    const outcome = run(context, "place_item", { listingId: BEAN_BAG, xMm: 1800, yMm: 3300, rotationDeg: 0, reason: "Between the beds." });
    expect(result<{ problems: string[] }>(outcome).problems.join(" ")).toMatch(/blocks the 915 mm path from the (west|east) bed to the door/);
  });

  it("moves an item already in the plan without charging it twice", () => {
    const context = harborContext();
    run(context, "place_item", { listingId: BEAN_BAG, xMm: 1750, yMm: 2150, rotationDeg: 0, reason: "Lounge spot." });
    const moved = run(context, "place_item", { listingId: BEAN_BAG, xMm: 1800, yMm: 1500, rotationDeg: 90, reason: "Closer to the window." });
    expect(result<{ placed: boolean; spentCents: number }>(moved)).toMatchObject({ placed: true, spentCents: 3_000 });
    expect(moved.events[0].sentence).toMatch(/^Moved the bean bag /);
    expect(context.layout.items).toHaveLength(1);
    expect(context.layout.items[0]).toMatchObject({ xMm: 1800, yMm: 1500, rotationDeg: 90 });
  });

  it("refuses a second refrigerator beyond the per resident limit", () => {
    const context = harborContext();
    run(context, "place_item", { listingId: FRIDGE, xMm: 286, yMm: 1540, rotationDeg: 270, reason: "Snacks." });
    const second = { ...context.catalog.get(FRIDGE)!, id: "4f4b3c1e-2c6f-5d0e-9d4a-3b1a2c0e9f11", title: "Second fridge" };
    context.catalog = new Map([...context.catalog, [second.id, second]]);
    const outcome = run(context, "place_item", { listingId: second.id, xMm: 3300, yMm: 1500, rotationDeg: 90, reason: "More snacks." });
    expect(result<{ problems: string[] }>(outcome).problems.join(" ")).toMatch(/rule 1\.2/);
  });

  it("answers an unknown listing with a problem the model can act on", () => {
    const outcome = run(harborContext(), "place_item", { listingId: "00000000-0000-4000-8000-000000000000", xMm: 1, yMm: 1, rotationDeg: 0, reason: "x" });
    expect(result<{ placed: boolean; problems: string[] }>(outcome).problems[0]).toMatch(/^No active listing/);
  });
});

describe("remove_item", () => {
  it("takes an item out and lowers the total", () => {
    const context = harborContext();
    const placed = result<{ itemKey: string }>(run(context, "place_item", { listingId: BEAN_BAG, xMm: 1750, yMm: 2150, rotationDeg: 0, reason: "Lounge spot." }));
    const outcome = run(context, "remove_item", { itemKey: placed.itemKey, reason: "Too big." });
    expect(result<{ removed: boolean; spentCents: number }>(outcome)).toMatchObject({ removed: true, spentCents: 0 });
    expect(outcome.events[0].sentence).toBe("Took the bean bag from Lea out of the plan.");
  });

  it("keeps a desk that still holds a lamp", () => {
    const context = harborContext();
    const desk = result<{ itemKey: string }>(run(context, "place_item", { listingId: DESK, xMm: 1800, yMm: 600, rotationDeg: 0, reason: "Desk." }));
    run(context, "place_item", { listingId: LAMP, xMm: 2150, yMm: 480, rotationDeg: 0, reason: "Lamp." });
    const outcome = run(context, "remove_item", { itemKey: desk.itemKey, reason: "Swap." });
    expect(result<{ removed: boolean; problems: string[] }>(outcome).problems[0]).toMatch(/stands on white-three-drawer-desk-with-oak-legs/);
    expect(context.layout.items).toHaveLength(2);
  });

  it("answers an unknown key", () => {
    expect(result<{ removed: boolean }>(run(harborContext(), "remove_item", { itemKey: "nope", reason: "x" })).removed).toBe(false);
  });
});
