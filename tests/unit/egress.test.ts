import { describe, expect, it } from "vitest";
import { bedEgress, EGRESS_PATH_MM } from "@/lib/domain/egress";
import { checkFit, checkLayout, type FitRoom } from "@/lib/domain/fit";
import { rectangle } from "@/lib/domain/geometry";
import type { LayoutItem } from "@/lib/domain/layout";
import { seedRoomPresets } from "@/scripts/seed/halls";

/** The fit tests' room: a bed on the west wall, the door at the east end of the south wall. */
const ROOM: FitRoom = {
  widthMm: 3000,
  depthMm: 4000,
  ceilingHeightMm: 2400,
  geometry: {
    doors: [{ wall: "south", offsetMm: 1800, widthMm: 900, heightMm: 2032, swing: "in", hinge: "left" }],
    windows: [],
    fixtures: [{ kind: "bed", label: "Bed", xMm: 457, yMm: 2000, widthMm: 914, depthMm: 2032, heightMm: 762, rotationDeg: 0 }],
  },
};

function item(key: string, xMm: number, yMm: number, widthMm: number, depthMm: number, overrides: Partial<LayoutItem> = {}): LayoutItem {
  return {
    key,
    source: "listing",
    listingId: "5b0c6a43-8f4a-5a1e-9a3c-2f6c1d9e7b10",
    furnitureType: "bookcase",
    placement: "floor",
    widthMm,
    depthMm,
    heightMm: 1000,
    pieces: 1,
    xMm,
    yMm,
    elevationMm: 0,
    rotationDeg: 0,
    ...overrides,
  } as LayoutItem;
}

describe("bedEgress", () => {
  it("finds a path from every bed to the door in each empty preset", () => {
    for (const preset of seedRoomPresets()) {
      const room = { widthMm: preset.widthMm, depthMm: preset.depthMm, ceilingHeightMm: preset.ceilingHeightMm, geometry: preset.geometry };
      expect(bedEgress(room, []).every((bed) => bed.reachable)).toBe(true);
    }
  });

  it("closes when a wall of furniture spans the room between the bed and the door", () => {
    const wall = rectangle(1957, 3000, 2086, 400, 0);
    expect(bedEgress(ROOM, [wall])).toEqual([{ bed: "bed", reachable: false }]);
  });

  it("stays open beside a small item and measures the width it was given", () => {
    expect(bedEgress(ROOM, [rectangle(2600, 1000, 400, 400, 0)])[0].reachable).toBe(true);
    // A 1186 mm gap between the bed and a cabinet passes 915 mm and fails 1300 mm.
    const cabinet = rectangle(2550, 1800, 900, 2400, 0);
    expect(bedEgress(ROOM, [cabinet], EGRESS_PATH_MM)[0].reachable).toBe(true);
    expect(bedEgress(ROOM, [cabinet], 1300)[0].reachable).toBe(false);
  });

  it("starts only from bed sides that face open floor", () => {
    // Fill the floor beside the bed's open side. The foot still reaches the door.
    expect(bedEgress(ROOM, [rectangle(1500, 2000, 400, 2032, 0)])[0].reachable).toBe(true);
  });
});

describe("egress in the fit check", () => {
  it("charges the candidate that closes the path", () => {
    const wall = item("wall", 1957, 3000, 2086, 400);
    expect(checkFit(ROOM, { items: [] }, wall).problems.map((problem) => problem.code)).toContain("egress_blocked");
    expect(checkFit(ROOM, { items: [] }, wall).problems.find((problem) => problem.code === "egress_blocked")?.message).toBe("wall blocks the 915 mm path from the bed to the door.");
  });

  it("uses the room's own egress width", () => {
    const cabinet = item("cabinet", 2550, 1800, 900, 2400);
    expect(checkFit(ROOM, { items: [] }, cabinet).problems).toEqual([]);
    expect(checkFit({ ...ROOM, egressPathMm: 1300 }, { items: [] }, cabinet).problems.map((problem) => problem.code)).toEqual(["egress_blocked"]);
  });

  it("ignores rugs and items standing on furniture", () => {
    const rug = item("rug", 1957, 3000, 2086, 400, { furnitureType: "rug", placement: "underlay", heightMm: 10 });
    expect(checkFit(ROOM, { items: [] }, rug).problems).toEqual([]);
  });

  it("names the latest floor item whose removal opens the path in a whole layout", () => {
    const left = item("left", 1300, 3000, 400, 400);
    const right = item("right", 2400, 3000, 1200, 400);
    const problems = checkLayout(ROOM, { items: [left, right] }).problems.filter((problem) => problem.code === "egress_blocked");
    expect(problems).toEqual([expect.objectContaining({ itemKey: "right", otherKey: "bed" })]);
  });
});
