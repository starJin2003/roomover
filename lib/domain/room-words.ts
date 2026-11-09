import type { FitProblem, FitRoom } from "./fit";
import type { FurnitureType } from "./furniture";
import { bounds, rectangle, type Bounds } from "./geometry";
import { footprint, topMm, type LayoutItem, type PlanLayout } from "./layout";
import { supportFor } from "./placement";
import { wallLengthMm, type Wall } from "./room";

/**
 * Everyday words for items and where they stand, so the activity panel can
 * say "Found a desk that fits under the window" in place of coordinates.
 */

const NOUN: Readonly<Record<FurnitureType, readonly [one: string, set: string]>> = {
  comforter: ["comforter", "comforter"],
  pillows: ["set of pillows", "set of pillows"],
  throw: ["throw", "throw"],
  desk: ["desk", "desk"],
  desk_chair: ["desk chair", "desk chair"],
  side_chair: ["chair", "set of chairs"],
  armchair: ["armchair", "set of armchairs"],
  bean_bag: ["bean bag", "bean bag"],
  pouf: ["pouf", "set of poufs"],
  bookcase: ["bookcase", "set of bookcases"],
  desk_lamp: ["desk lamp", "desk lamp"],
  table_lamp: ["table lamp", "table lamp"],
  clamp_lamp: ["clamp lamp", "clamp lamp"],
  floor_lamp: ["floor lamp", "floor lamp"],
  rug: ["rug", "rug"],
  round_rug: ["round rug", "round rug"],
  mini_fridge: ["mini fridge", "mini fridge"],
  drawer_unit: ["drawer unit", "drawer unit"],
  basket: ["basket", "set of baskets"],
  tote: ["storage tote", "storage tote"],
};

export function itemNoun(item: Pick<LayoutItem, "furnitureType" | "pieces">): string {
  const [one, set] = NOUN[item.furnitureType];
  return item.pieces > 1 ? set : one;
}

/** "a desk" or "an armchair". */
export function withArticle(noun: string): string {
  return `${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}`;
}

const NEAR_WINDOW_MM = 900;
const NEAR_DOOR_MM = 1100;
const BESIDE_BED_MM = 350;
const AGAINST_WALL_MM = 400;

function gap(a: Bounds, b: Bounds): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
  return Math.hypot(dx, dy);
}

/** The strip of floor along a stretch of wall, `depth` deep into the room. */
function wallStrip(room: FitRoom, wall: Wall, from: number, to: number, depth: number): Bounds {
  switch (wall) {
    case "north":
      return { minX: from, maxX: to, minY: 0, maxY: depth };
    case "south":
      return { minX: from, maxX: to, minY: room.depthMm - depth, maxY: room.depthMm };
    case "west":
      return { minX: 0, maxX: depth, minY: from, maxY: to };
    case "east":
      return { minX: room.widthMm - depth, maxX: room.widthMm, minY: from, maxY: to };
  }
}

function floorPhrase(room: FitRoom, item: LayoutItem): string {
  const box = bounds(footprint(item));
  const window = room.geometry.windows.find((candidate) => gap(box, wallStrip(room, candidate.wall, candidate.offsetMm, candidate.offsetMm + candidate.widthMm, NEAR_WINDOW_MM)) === 0);
  if (window !== undefined && item.placement === "floor") return topMm(item) <= window.sillHeightMm ? "under the window" : "by the window";
  const door = room.geometry.doors.find((candidate) => gap(box, wallStrip(room, candidate.wall, candidate.offsetMm, candidate.offsetMm + candidate.widthMm, 1)) < NEAR_DOOR_MM);
  if (door !== undefined) return "by the door";
  const bed = room.geometry.fixtures
    .filter((fixture) => fixture.kind === "bed")
    .find((fixture) => gap(box, bounds(rectangle(fixture.xMm, fixture.yMm, fixture.widthMm, fixture.depthMm, fixture.rotationDeg))) < BESIDE_BED_MM);
  if (bed !== undefined) return `beside the ${bed.label.toLowerCase()}`;
  if (window !== undefined) return "by the window";
  const walls = (["north", "east", "south", "west"] as const).filter(
    (wall) => gap(box, wallStrip(room, wall, 0, wallLengthMm(wall, room), AGAINST_WALL_MM)) === 0,
  );
  return walls.length === 1 ? `against the ${walls[0]} wall` : walls.length > 1 ? "in a corner" : "in the middle of the room";
}

/** Where the item stands, in words, such as "on the east desk" or "under the window". */
export function whereIs(room: FitRoom, layout: PlanLayout, item: LayoutItem): string {
  if (item.placement === "surface" || item.placement === "bed") {
    const others = { items: layout.items.filter((other) => other.key !== item.key) };
    const support = supportFor(room, others, item);
    if (support?.hostKey === undefined) return "in the room";
    const host = support.hostSource === "item" ? others.items.find((other) => other.key === support.hostKey) : undefined;
    const hostName = host === undefined ? support.hostKey : itemNoun(host);
    const under = item.placement === "bed" && support.elevationMm === 0;
    return `${under ? "under" : "on"} the ${hostName}`;
  }
  return floorPhrase(room, item);
}

/** One problem from the fit check, said the way a student would understand it. */
export function fitProblemWords(problem: FitProblem, layout: PlanLayout): string {
  const other = layout.items.find((item) => item.key === problem.otherKey);
  const otherName = other === undefined ? problem.otherKey : itemNoun(other);
  switch (problem.code) {
    case "out_of_bounds":
      return "It would reach past a wall.";
    case "overlap":
      return otherName === undefined ? "It would overlap something." : `It would overlap the ${otherName}.`;
    case "door_swing":
      return "It would block the door.";
    case "window_blocked":
      return "It would stand in front of the window.";
    case "wall_clearance":
      return otherName === undefined ? "It needs a gap from the wall to vent." : `It needs more room around the ${otherName}.`;
    case "no_support":
      return "It needs a desk or shelf under it.";
    case "egress_blocked":
      return `It would block the path from the ${problem.otherKey ?? "bed"} to the door.`;
  }
}
