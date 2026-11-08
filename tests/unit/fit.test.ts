import { describe, expect, it } from "vitest";
import { checkFit, checkLayout, doorZone, type FitRoom } from "@/lib/domain/fit";
import { bounds } from "@/lib/domain/geometry";
import type { LayoutItem } from "@/lib/domain/layout";

const LISTING_ID = "5b0c6a43-8f4a-5a1e-9a3c-2f6c1d9e7b10";

/**
 * A 3000 by 4000 mm room. The bed runs along the west wall, the desk sits in
 * the north east corner, a radiator stands under the north window, and the
 * door on the south wall swings in from a hinge at its east end.
 */
const ROOM: FitRoom = {
  widthMm: 3000,
  depthMm: 4000,
  ceilingHeightMm: 2400,
  geometry: {
    doors: [{ wall: "south", offsetMm: 1800, widthMm: 900, heightMm: 2032, swing: "in", hinge: "left" }],
    windows: [{ wall: "north", offsetMm: 1000, widthMm: 1000, heightMm: 1200, sillHeightMm: 800 }],
    fixtures: [
      { kind: "bed", label: "Bed", xMm: 457, yMm: 2000, widthMm: 914, depthMm: 2032, heightMm: 762, rotationDeg: 0 },
      { kind: "desk", label: "Desk", xMm: 2466, yMm: 305, widthMm: 1067, depthMm: 610, heightMm: 762, rotationDeg: 0 },
      { kind: "radiator", label: "Radiator", xMm: 1400, yMm: 100, widthMm: 600, depthMm: 200, heightMm: 600, rotationDeg: 0 },
    ],
  },
};

function item(overrides: Partial<LayoutItem> = {}): LayoutItem {
  return {
    key: "box",
    source: "listing",
    listingId: LISTING_ID,
    furnitureType: "drawer_unit",
    placement: "floor",
    widthMm: 400,
    depthMm: 400,
    heightMm: 400,
    pieces: 1,
    xMm: 1500,
    yMm: 2000,
    elevationMm: 0,
    rotationDeg: 0,
    ...overrides,
  } as LayoutItem;
}

const codes = (candidate: LayoutItem, others: LayoutItem[] = []) =>
  checkFit(ROOM, { items: others }, candidate).problems.map((problem) => problem.code);

describe("checkFit inside the room", () => {
  it("passes an item in open floor", () => {
    expect(checkFit(ROOM, { items: [] }, item())).toEqual({ fits: true, problems: [] });
  });

  it("flags an item that reaches past a wall or above the ceiling", () => {
    expect(codes(item({ xMm: 100, yMm: 3500 }))).toEqual(["out_of_bounds"]);
    expect(codes(item({ yMm: 3900 }))).toContain("out_of_bounds");
    expect(codes(item({ heightMm: 2500 }))).toEqual(["out_of_bounds"]);
  });
});

describe("checkFit overlap", () => {
  it("flags provided furniture and names it", () => {
    const result = checkFit(ROOM, { items: [] }, item({ xMm: 700 }));
    expect(result.fits).toBe(false);
    expect(result.problems).toEqual([expect.objectContaining({ code: "overlap", otherKey: "bed" })]);
  });

  it("flags placed items and lets items touch", () => {
    const placed = item({ key: "placed" });
    expect(codes(item({ key: "new" }), [placed])).toEqual(["overlap"]);
    expect(codes(item({ key: "new", xMm: 1900 }), [placed])).toEqual([]);
  });

  it("lets rugs lie under furniture and keeps two rugs apart", () => {
    const rug = item({ key: "rug", furnitureType: "rug", placement: "underlay", widthMm: 1600, depthMm: 2400, heightMm: 10, xMm: 1200 });
    expect(codes(rug)).toEqual([]);
    expect(codes(item({ key: "chair" }), [rug])).toEqual([]);
    expect(codes(item({ key: "second rug", furnitureType: "round_rug", placement: "underlay", heightMm: 8, widthMm: 1200, depthMm: 1200 }), [rug])).toEqual(["overlap"]);
  });
});

describe("checkFit door swing", () => {
  it("keeps the quarter disc clear and allows the corner outside the arc", () => {
    expect(codes(item({ xMm: 2300, yMm: 3700 }))).toEqual(["door_swing"]);
    expect(codes(item({ xMm: 1500, yMm: 3700 }))).toEqual([]);
    expect(codes(item({ widthMm: 200, depthMm: 200, xMm: 1950, yMm: 3250 }))).toEqual([]);
  });

  it("follows the hinge side seen from inside the room", () => {
    const room: FitRoom = {
      ...ROOM,
      geometry: { ...ROOM.geometry, doors: [{ ...ROOM.geometry.doors[0], hinge: "right" }] },
    };
    const corner = item({ widthMm: 200, depthMm: 200, xMm: 1950, yMm: 3250 });
    expect(checkFit(room, { items: [] }, corner).problems.map((problem) => problem.code)).toEqual(["door_swing"]);
    expect(bounds(doorZone(room, room.geometry.doors[0]))).toEqual({ minX: 1800, minY: 3100, maxX: 2700, maxY: 4000 });
  });

  it("lets a thin rug pass under the door and stops a thick one", () => {
    const rug = { furnitureType: "rug", placement: "underlay", widthMm: 1200, depthMm: 800, xMm: 2200, yMm: 3500 } as const;
    expect(codes(item({ ...rug, heightMm: 10 }))).toEqual([]);
    expect(codes(item({ ...rug, heightMm: 20 }))).toEqual(["door_swing"]);
  });

  it("keeps a doorway clear when the door swings out", () => {
    const room: FitRoom = {
      ...ROOM,
      geometry: { ...ROOM.geometry, doors: [{ ...ROOM.geometry.doors[0], swing: "out" }] },
    };
    const fit = (candidate: LayoutItem) => checkFit(room, { items: [] }, candidate).problems.map((problem) => problem.code);
    expect(fit(item({ xMm: 2250, yMm: 3790 }))).toEqual(["door_swing"]);
    expect(fit(item({ xMm: 2300, yMm: 3500 }))).toEqual([]);
  });
});

describe("checkFit window", () => {
  it("keeps anything taller than the sill out of the floor in front of a window", () => {
    expect(codes(item({ widthMm: 400, depthMm: 200, heightMm: 1000, yMm: 500 }))).toEqual(["window_blocked"]);
    expect(codes(item({ widthMm: 400, depthMm: 200, heightMm: 700, yMm: 500 }))).toEqual([]);
    expect(codes(item({ widthMm: 400, depthMm: 200, heightMm: 1000, yMm: 800 }))).toEqual([]);
  });

  it("lets a lamp stand on a desk in front of a window", () => {
    const desk = item({ key: "desk", furnitureType: "desk", widthMm: 800, depthMm: 400, heightMm: 750, xMm: 1500, yMm: 600 });
    const lamp = item({ key: "lamp", furnitureType: "desk_lamp", placement: "surface", widthMm: 200, depthMm: 150, heightMm: 480, xMm: 1500, yMm: 600, elevationMm: 750 });
    expect(codes(desk)).toEqual([]);
    expect(codes(lamp, [desk])).toEqual([]);
  });
});

describe("checkFit wall clearance", () => {
  const fridge = { key: "fridge", furnitureType: "mini_fridge", widthMm: 445, depthMm: 470, heightMm: 510, yMm: 3600 } as const;

  it("keeps a compact fridge 50 mm from the walls", () => {
    expect(codes(item({ ...fridge, xMm: 223 }))).toEqual(["wall_clearance"]);
    expect(codes(item({ ...fridge, xMm: 273 }))).toEqual([]);
  });

  it("measures the clearance from the corners of a turned item", () => {
    expect(codes(item({ ...fridge, xMm: 340, rotationDeg: 45 }))).toEqual(["wall_clearance"]);
    expect(codes(item({ ...fridge, xMm: 390, rotationDeg: 45 }))).toEqual([]);
  });

  it("keeps the floor in front of a radiator clear", () => {
    expect(checkFit(ROOM, { items: [] }, item({ widthMm: 400, depthMm: 200, xMm: 1400, yMm: 400 })).problems).toEqual([
      expect.objectContaining({ code: "wall_clearance", otherKey: "radiator" }),
    ]);
    expect(codes(item({ widthMm: 400, depthMm: 200, xMm: 1400, yMm: 450 }))).toEqual([]);
  });
});

describe("checkFit rotation", () => {
  const bookcase = { furnitureType: "bookcase", widthMm: 1500, depthMm: 300, heightMm: 1060, xMm: 2840, yMm: 1500 } as const;

  it("fits a long item turned along a wall and rejects it across the room", () => {
    expect(codes(item({ ...bookcase, rotationDeg: 90 }))).toEqual([]);
    expect(codes(item({ ...bookcase, rotationDeg: 270 }))).toEqual([]);
    expect(codes(item({ ...bookcase, rotationDeg: 0 }))).toEqual(["out_of_bounds"]);
    expect(codes(item({ ...bookcase, rotationDeg: 45 }))).toEqual(["out_of_bounds"]);
  });

  it("measures a turned item against furniture by its true corners", () => {
    const long = item({ widthMm: 1200, depthMm: 200, xMm: 1560, yMm: 2000 });
    expect(codes(long)).toEqual([]);
    expect(codes({ ...long, rotationDeg: 30 })).toEqual([]);
    expect(codes({ ...long, xMm: 1350, rotationDeg: 0 })).toEqual(["overlap"]);
    expect(codes({ ...long, xMm: 1350, rotationDeg: 90 })).toEqual([]);
  });
});

describe("checkFit support", () => {
  const lamp = { key: "lamp", furnitureType: "table_lamp", placement: "surface", widthMm: 300, depthMm: 300, heightMm: 520 } as const;

  it("stands a lamp on the provided desk at its top height", () => {
    expect(codes(item({ ...lamp, xMm: 2700, yMm: 300, elevationMm: 762 }))).toEqual([]);
    expect(codes(item({ ...lamp, xMm: 2700, yMm: 300, elevationMm: 700 }))).toEqual(["no_support"]);
    expect(codes(item({ ...lamp, xMm: 1500, yMm: 2000, elevationMm: 762 }))).toEqual(["no_support"]);
  });

  it("keeps two items on one desk apart", () => {
    const first = item({ ...lamp, xMm: 2700, yMm: 300, elevationMm: 762 });
    expect(codes(item({ ...lamp, key: "second", xMm: 2600, yMm: 300, elevationMm: 762 }), [first])).toEqual(["overlap"]);
    expect(codes(item({ ...lamp, key: "second", xMm: 2200, yMm: 300, elevationMm: 762 }), [first])).toEqual([]);
  });

  it("slides storage under a bed only when it clears the frame", () => {
    const tote = { key: "tote", furnitureType: "tote", placement: "bed", widthMm: 690, depthMm: 450, heightMm: 330, xMm: 457, yMm: 1500 } as const;
    expect(codes(item(tote))).toEqual([]);
    expect(codes(item({ ...tote, heightMm: 600 }))).toEqual(["overlap"]);
    expect(codes(item({ ...tote, xMm: 1500 }))).toEqual(["no_support"]);
  });

  it("lays bedding on the mattress", () => {
    const pillows = { key: "pillows", furnitureType: "pillows", placement: "bed", widthMm: 510, depthMm: 660, heightMm: 150, pieces: 3, xMm: 457, yMm: 2800 } as const;
    expect(codes(item({ ...pillows, elevationMm: 762 }))).toEqual([]);
    expect(codes(item({ ...pillows, elevationMm: 0 }))).toEqual(["no_support"]);
  });

  it("hangs a wall item on a wall and off the window", () => {
    const shelf = { key: "shelf", furnitureType: "bookcase", placement: "wall", widthMm: 600, depthMm: 200, heightMm: 300, elevationMm: 1500 } as const;
    expect(codes(item({ ...shelf, xMm: 2400, yMm: 100 }))).toEqual([]);
    expect(codes(item({ ...shelf, xMm: 1500, yMm: 2000 }))).toEqual(["no_support"]);
    expect(codes(item({ ...shelf, xMm: 1500, yMm: 100 }))).toEqual(["window_blocked"]);
  });
});

describe("checkLayout", () => {
  it("reports each colliding pair once", () => {
    const result = checkLayout(ROOM, { items: [item({ key: "a" }), item({ key: "b", xMm: 1600 })] });
    expect(result.problems).toEqual([expect.objectContaining({ code: "overlap", itemKey: "b", otherKey: "a" })]);
  });

  it("finds a host placed after the item that stands on it", () => {
    const desk = item({ key: "desk", furnitureType: "desk", widthMm: 1000, depthMm: 500, heightMm: 750 });
    const lamp = item({ key: "lamp", furnitureType: "desk_lamp", placement: "surface", widthMm: 200, depthMm: 150, heightMm: 480, elevationMm: 750 });
    expect(checkLayout(ROOM, { items: [lamp, desk] }).fits).toBe(true);
  });
});
