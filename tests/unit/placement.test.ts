import { describe, expect, it } from "vitest";
import { checkLayout } from "@/lib/domain/fit";
import type { PlanLayout } from "@/lib/domain/layout";
import { itemKeyFor, layoutItemFor, moveItem, putItem, removeItem, riders, settle, supportFor } from "@/lib/domain/placement";
import { harborContext, listingId } from "./support/buyer-context";

const context = harborContext();
const listing = (slug: string) => {
  const found = context.catalog.get(listingId(slug));
  if (found === undefined) throw new Error(`No listing ${slug}.`);
  return found;
};
const place = (layout: PlanLayout, slug: string, xMm: number, yMm: number, rotationDeg = 0) =>
  putItem(layout, settle(context.room, layout, layoutItemFor(listing(slug), { xMm, yMm, rotationDeg }, layout)));

describe("supportFor and settle", () => {
  it("puts floor items on the floor and lamps on the provided desk", () => {
    const lamp = layoutItemFor(listing("ava-desk-lamp"), { xMm: 534, yMm: 300, rotationDeg: 0 }, { items: [] });
    expect(supportFor(context.room, { items: [] }, lamp)).toEqual({ elevationMm: 762, hostKey: "west desk", hostSource: "fixture" });
    const chair = layoutItemFor(listing("lea-navy-bean-bag"), { xMm: 1750, yMm: 2150, rotationDeg: 0 }, { items: [] });
    expect(supportFor(context.room, { items: [] }, chair)).toEqual({ elevationMm: 0 });
  });

  it("prefers a placed desk under a lamp", () => {
    const layout = place({ items: [] }, "jun-white-desk", 1800, 600);
    const lamp = settle(context.room, layout, layoutItemFor(listing("ava-desk-lamp"), { xMm: 2150, yMm: 480, rotationDeg: 0 }, layout));
    expect(lamp.elevationMm).toBe(750);
  });

  it("lays bedding on the mattress and slides storage under the frame", () => {
    const throwItem = settle(context.room, { items: [] }, layoutItemFor(listing("lea-crochet-throw"), { xMm: 457, yMm: 2800, rotationDeg: 0 }, { items: [] }));
    expect(throwItem.elevationMm).toBe(762);
    const tote = layoutItemFor(listing("lea-moving-tote"), { xMm: 3143, yMm: 2400, rotationDeg: 0 }, { items: [] });
    expect(supportFor(context.room, { items: [] }, tote)).toMatchObject({ elevationMm: 0, hostKey: "east bed" });
  });

  it("finds nothing under a lamp in open floor", () => {
    const lamp = layoutItemFor(listing("ava-desk-lamp"), { xMm: 1800, yMm: 2500, rotationDeg: 0 }, { items: [] });
    expect(supportFor(context.room, { items: [] }, lamp)).toBeUndefined();
  });
});

describe("moveItem", () => {
  it("carries a lamp with its desk through a move and a quarter turn", () => {
    let layout = place({ items: [] }, "jun-white-desk", 1800, 600);
    layout = place(layout, "ava-desk-lamp", 2150, 480);
    const desk = layout.items[0];
    expect(riders(layout, desk).map((rider) => rider.key)).toEqual(["black-balance-arm-desk-lamp"]);

    const shifted = moveItem(context.room, layout, desk.key, { xMm: 1800, yMm: 800, rotationDeg: 0 });
    expect(shifted.moved.map((item) => item.key)).toEqual([desk.key, "black-balance-arm-desk-lamp"]);
    expect(shifted.layout.items[1]).toMatchObject({ xMm: 2150, yMm: 680, elevationMm: 750 });

    const turned = moveItem(context.room, layout, desk.key, { xMm: 1800, yMm: 600, rotationDeg: 90 });
    // A clockwise quarter turn takes the lamp from east of the desk's center to south of it.
    expect(turned.layout.items[1]).toMatchObject({ xMm: 1920, yMm: 950, rotationDeg: 90 });
  });

  it("keeps the order of the layout and only touches what moved", () => {
    let layout = place({ items: [] }, "lea-navy-bean-bag", 1750, 2150);
    layout = place(layout, "jun-round-jute-rug", 1800, 2600);
    const move = moveItem(context.room, layout, "navy-bean-bag-chair-with-matching-pouf", { xMm: 1800, yMm: 1500, rotationDeg: 0 });
    expect(move.layout.items.map((item) => item.key)).toEqual(layout.items.map((item) => item.key));
    expect(move.layout.items[1]).toBe(layout.items[1]);
    expect(checkLayout(context.room, move.layout).problems).toEqual([]);
  });

  it("fails loudly for a key that is not in the layout", () => {
    expect(() => moveItem(context.room, { items: [] }, "missing", { xMm: 0, yMm: 0, rotationDeg: 0 })).toThrow("No item missing in the layout.");
  });
});

describe("keys and edits", () => {
  it("makes short readable keys, unique within a layout, and reuses a listing's key", () => {
    const layout = place({ items: [] }, "jun-white-desk", 1800, 600);
    expect(itemKeyFor("White three drawer desk with oak legs", layout, "00000000-0000-4000-8000-000000000001")).toBe("white-three-drawer-desk-with-oak-legs-2");
    expect(itemKeyFor("Anything", layout, listingId("jun-white-desk"))).toBe("white-three-drawer-desk-with-oak-legs");
  });

  it("replaces an item in place and removes by key", () => {
    const layout = place({ items: [] }, "lea-navy-bean-bag", 1750, 2150);
    const moved = putItem(layout, { ...layout.items[0], xMm: 1700 });
    expect(moved.items).toHaveLength(1);
    expect(moved.items[0].xMm).toBe(1700);
    expect(removeItem(moved, moved.items[0].key).items).toEqual([]);
  });

  it("rounds spots to whole millimeters and wraps turns into 0 to 359", () => {
    const item = layoutItemFor(listing("lea-navy-bean-bag"), { xMm: 1750.6, yMm: -4, rotationDeg: -90 }, { items: [] });
    expect(item).toMatchObject({ xMm: 1751, yMm: 0, rotationDeg: 270 });
  });
});
