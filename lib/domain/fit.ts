import { bedEgress, EGRESS_PATH_MM } from "./egress";
import { FURNITURE } from "./furniture";
import { bounds, boxPolygon, contains, grow, overlaps, quarterDisc, rectangle, type Point, type Polygon } from "./geometry";
import { footprint, topMm, type LayoutItem, type PlanLayout } from "./layout";
import type { Door, Fixture, FixtureKind, RoomGeometry, RoomSize, RoomWindow, Wall } from "./room";

/**
 * The geometry check behind the buyer agent's `check_fit` tool. It measures one
 * item against the room, the provided furniture, and the items already placed,
 * and lists every problem in words the agent can repeat to the student.
 */

/** Floor in front of a window that stays below the sill. */
export const WINDOW_CLEAR_DEPTH_MM = 600;
/** Clear floor in front of a radiator or heater on every side. */
export const HEATER_CLEARANCE_MM = 150;
/** Rugs this thin pass under a door leaf. */
export const RUG_UNDER_DOOR_MAX_MM = 12;
/** Depth of the clear zone inside a door that swings out of the room. */
export const DOORWAY_DEPTH_MM = 300;
/** The provided mattress depth, so storage under a bed fits below the frame. */
export const BED_MATTRESS_MM = 203;
/** How far an item may sit above or below the top it stands on. */
export const LEVEL_TOLERANCE_MM = 10;
/** A wall item sits within this distance of its wall. */
export const WALL_TOUCH_MM = 25;

export const FIT_PROBLEM_CODES = ["out_of_bounds", "overlap", "door_swing", "window_blocked", "wall_clearance", "no_support", "egress_blocked"] as const;
export type FitProblemCode = (typeof FIT_PROBLEM_CODES)[number];

export interface FitProblem {
  code: FitProblemCode;
  itemKey: string;
  /** The fixture label or layout key the item collides with. */
  otherKey?: string;
  message: string;
}

export interface FitResult {
  fits: boolean;
  problems: FitProblem[];
}

export interface FitRoom extends RoomSize {
  geometry: RoomGeometry;
  /** Width of the clear path from each bed to the door, from the hall rules. */
  egressPathMm?: number;
}

interface Solid {
  key: string;
  polygon: Polygon;
  top: number;
}

interface FixtureSolid extends Solid {
  kind: FixtureKind;
}

const SURFACE_FIXTURES: readonly FixtureKind[] = ["desk", "dresser"];
const UNDER_BED_TYPES = new Set(["tote", "basket", "drawer_unit"]);

/** Checks a candidate item against the room and every other item in the layout. */
export function checkFit(room: FitRoom, layout: PlanLayout, candidate: LayoutItem): FitResult {
  const others = layout.items.filter((item) => item.key !== candidate.key);
  const problems = itemProblems(room, candidate, others, others);
  if (candidate.placement === "floor") {
    const width = room.egressPathMm ?? EGRESS_PATH_MM;
    const before = bedEgress(room, floorShapes(others), width);
    const after = bedEgress(room, floorShapes([...others, candidate]), width);
    after.forEach((bed, index) => {
      if (before[index].reachable && !bed.reachable) problems.push(egressProblem(candidate.key, bed.bed, width));
    });
  }
  return result(problems);
}

/** Checks every item of a layout and reports each colliding pair once. */
export function checkLayout(room: FitRoom, layout: PlanLayout): FitResult {
  const problems = layout.items.flatMap((item, index) =>
    itemProblems(
      room,
      item,
      layout.items.filter((other) => other.key !== item.key),
      layout.items.slice(0, index),
    ),
  );
  return result([...problems, ...layoutEgressProblems(room, layout.items)]);
}

const floorShapes = (items: readonly LayoutItem[]): Polygon[] => items.filter((item) => item.placement === "floor").map(footprint);

function egressProblem(itemKey: string, bed: string, width: number): FitProblem {
  return { code: "egress_blocked", itemKey, otherKey: bed, message: `${itemKey} blocks the ${width} mm path from the ${bed} to the door.` };
}

/**
 * Each bed cut off from the door is charged to the latest floor item whose
 * removal opens the path again, or to the room when no single item does.
 */
function layoutEgressProblems(room: FitRoom, items: readonly LayoutItem[]): FitProblem[] {
  const width = room.egressPathMm ?? EGRESS_PATH_MM;
  const floor = items.filter((item) => item.placement === "floor");
  return bedEgress(room, floor.map(footprint), width).flatMap((bed, index) => {
    if (bed.reachable) return [];
    const culprit = [...floor].reverse().find((item) =>
      bedEgress(room, floor.filter((other) => other.key !== item.key).map(footprint), width)[index].reachable,
    );
    return [egressProblem(culprit?.key ?? "room", bed.bed, width)];
  });
}

function result(problems: FitProblem[]): FitResult {
  return { fits: problems.length === 0, problems };
}

/**
 * `others` holds every other item, for support and hosts. `pairs` holds the
 * items to test for collisions, so a whole layout reports each pair once.
 */
function itemProblems(room: FitRoom, item: LayoutItem, others: LayoutItem[], pairs: LayoutItem[]): FitProblem[] {
  const problems: FitProblem[] = [];
  const add = (code: FitProblemCode, message: string, otherKey?: string) =>
    problems.push({ code, itemKey: item.key, message, ...(otherKey === undefined ? {} : { otherKey }) });

  const shape = footprint(item);
  const roomShape = boxPolygon({ minX: 0, minY: 0, maxX: room.widthMm, maxY: room.depthMm });
  // Bedding is sold flat and drapes over the mattress, so the bed it lies on decides where it ends.
  const draped = item.placement === "bed" && !UNDER_BED_TYPES.has(item.furnitureType);
  if (!draped && !contains(roomShape, shape)) add("out_of_bounds", `${item.key} reaches past a wall.`);
  if (topMm(item) > room.ceilingHeightMm) add("out_of_bounds", `${item.key} rises above the ceiling.`);

  const fixtures = room.geometry.fixtures.map(fixtureSolid);

  switch (item.placement) {
    case "floor": {
      if (item.elevationMm !== 0) add("no_support", `${item.key} stands on the floor, so its elevation must be 0.`);
      for (const fixture of fixtures) {
        if (overlaps(shape, fixture.polygon)) add("overlap", `${item.key} overlaps the ${fixture.key}.`, fixture.key);
      }
      for (const other of pairs.filter((candidate) => candidate.placement === "floor")) {
        if (overlaps(shape, footprint(other))) add("overlap", `${item.key} overlaps ${other.key}.`, other.key);
      }
      doorProblems(room, item, shape, add);
      windowProblems(room, item, shape, add);
      clearanceProblems(room, item, shape, fixtures, add);
      break;
    }
    case "underlay": {
      if (item.elevationMm !== 0) add("no_support", `${item.key} lies on the floor, so its elevation must be 0.`);
      for (const other of pairs.filter((candidate) => candidate.placement === "underlay")) {
        if (overlaps(shape, footprint(other))) add("overlap", `${item.key} overlaps ${other.key}.`, other.key);
      }
      if (item.heightMm > RUG_UNDER_DOOR_MAX_MM) doorProblems(room, item, shape, add);
      break;
    }
    case "surface": {
      const host = surfaceHost(item, shape, fixtures, others);
      if (host === undefined) {
        add("no_support", `${item.key} needs a desk, dresser, or shelf top at ${item.elevationMm} mm under its whole base.`);
        break;
      }
      for (const other of pairs.filter((candidate) => candidate.placement === "surface")) {
        if (Math.abs(other.elevationMm - item.elevationMm) <= LEVEL_TOLERANCE_MM && overlaps(shape, footprint(other))) {
          add("overlap", `${item.key} overlaps ${other.key} on the ${host.key}.`, other.key);
        }
      }
      break;
    }
    case "bed": {
      bedProblems(item, shape, fixtures, pairs, add);
      break;
    }
    case "wall": {
      wallProblems(room, item, shape, add);
      break;
    }
  }
  return problems;
}

type Add = (code: FitProblemCode, message: string, otherKey?: string) => void;

function fixtureSolid(fixture: Fixture): FixtureSolid {
  return {
    key: fixture.label.toLowerCase(),
    kind: fixture.kind,
    polygon: rectangle(fixture.xMm, fixture.yMm, fixture.widthMm, fixture.depthMm, fixture.rotationDeg),
    top: fixture.heightMm,
  };
}

function surfaceHost(item: LayoutItem, shape: Polygon, fixtures: FixtureSolid[], others: LayoutItem[]): Solid | undefined {
  const hosts: Solid[] = [
    ...fixtures.filter((fixture) => SURFACE_FIXTURES.includes(fixture.kind) || (fixture.kind === "bed" && item.furnitureType === "clamp_lamp")),
    ...others
      .filter((other) => other.placement === "floor" && FURNITURE[other.furnitureType].host)
      .map((other) => ({ key: other.key, polygon: footprint(other), top: topMm(other) })),
  ];
  return hosts.find((host) => Math.abs(host.top - item.elevationMm) <= LEVEL_TOLERANCE_MM && contains(host.polygon, shape));
}

/** Storage slides under a bed frame. Bedding lies on the mattress and may drape past its edge. */
function bedProblems(item: LayoutItem, shape: Polygon, fixtures: FixtureSolid[], pairs: LayoutItem[], add: Add): void {
  const beds = fixtures.filter((fixture) => fixture.kind === "bed");
  if (UNDER_BED_TYPES.has(item.furnitureType)) {
    const bed = beds.find((candidate) => contains(candidate.polygon, shape));
    if (bed === undefined || item.elevationMm !== 0) {
      add("no_support", `${item.key} goes under a bed, so its whole base needs a bed frame above it.`);
      return;
    }
    const clearance = bed.top - BED_MATTRESS_MM;
    if (item.heightMm > clearance) add("overlap", `${item.key} is taller than the ${clearance} mm under the ${bed.key}.`, bed.key);
    for (const other of pairs.filter((candidate) => candidate.placement === "bed" && UNDER_BED_TYPES.has(candidate.furnitureType))) {
      if (overlaps(shape, footprint(other))) add("overlap", `${item.key} overlaps ${other.key} under the ${bed.key}.`, other.key);
    }
    return;
  }
  const center = [{ x: item.xMm, y: item.yMm }];
  const bed = beds.find((candidate) => contains(candidate.polygon, center) && Math.abs(candidate.top - item.elevationMm) <= LEVEL_TOLERANCE_MM);
  if (bed === undefined) add("no_support", `${item.key} lies on a bed, so its center needs a mattress at ${item.elevationMm} mm.`);
}

interface WallFrame {
  start: Point;
  along: Point;
  inward: Point;
}

function wallFrame(wall: Wall, room: RoomSize): WallFrame {
  switch (wall) {
    case "north":
      return { start: { x: 0, y: 0 }, along: { x: 1, y: 0 }, inward: { x: 0, y: 1 } };
    case "south":
      return { start: { x: 0, y: room.depthMm }, along: { x: 1, y: 0 }, inward: { x: 0, y: -1 } };
    case "west":
      return { start: { x: 0, y: 0 }, along: { x: 0, y: 1 }, inward: { x: 1, y: 0 } };
    case "east":
      return { start: { x: room.widthMm, y: 0 }, along: { x: 0, y: 1 }, inward: { x: -1, y: 0 } };
  }
}

const at = (frame: WallFrame, alongMm: number, inwardMm: number): Point => ({
  x: frame.start.x + frame.along.x * alongMm + frame.inward.x * inwardMm,
  y: frame.start.y + frame.along.y * alongMm + frame.inward.y * inwardMm,
});

/** A strip of floor along a wall opening, `depth` deep into the room. */
function openingZone(room: RoomSize, opening: Pick<RoomWindow, "wall" | "offsetMm" | "widthMm">, depth: number): Polygon {
  const frame = wallFrame(opening.wall, room);
  return boxPolygon(
    bounds([at(frame, opening.offsetMm, 0), at(frame, opening.offsetMm + opening.widthMm, depth)]),
  );
}

export interface DoorSwing {
  hinge: Point;
  /** Unit direction from the hinge along the closed leaf. */
  closed: Point;
  /** Unit direction from the hinge into the room. */
  inward: Point;
}

/** Where a door hangs. The hinge side is named as seen from inside the room while facing the door. */
export function doorSwing(room: RoomSize, door: Door): DoorSwing {
  const frame = wallFrame(door.wall, room);
  const right = { x: frame.inward.y, y: -frame.inward.x };
  const rightIsAlong = right.x * frame.along.x + right.y * frame.along.y > 0;
  const hingeAtEnd = (door.hinge === "right") === rightIsAlong;
  return {
    hinge: at(frame, door.offsetMm + (hingeAtEnd ? door.widthMm : 0), 0),
    closed: hingeAtEnd ? { x: -frame.along.x, y: -frame.along.y } : frame.along,
    inward: frame.inward,
  };
}

/** The floor a door leaf sweeps, or the doorway strip when the door swings out of the room. */
export function doorZone(room: RoomSize, door: Door): Polygon {
  if (door.swing === "out") return openingZone(room, door, DOORWAY_DEPTH_MM);
  const { hinge, closed, inward } = doorSwing(room, door);
  return quarterDisc(hinge, door.widthMm, closed, inward);
}

function doorProblems(room: FitRoom, item: LayoutItem, shape: Polygon, add: Add): void {
  room.geometry.doors.forEach((door) => {
    if (overlaps(shape, doorZone(room, door))) add("door_swing", `${item.key} blocks the swing of the ${door.wall} door.`, `${door.wall} door`);
  });
}

function windowProblems(room: FitRoom, item: LayoutItem, shape: Polygon, add: Add): void {
  room.geometry.windows.forEach((window) => {
    if (topMm(item) > window.sillHeightMm && overlaps(shape, openingZone(room, window, WINDOW_CLEAR_DEPTH_MM))) {
      add("window_blocked", `${item.key} stands ${topMm(item)} mm tall in front of a ${window.wall} window with a ${window.sillHeightMm} mm sill.`, `${window.wall} window`);
    }
  });
}

/** Distance from the footprint to the nearest wall, measured at the corners of the convex shape. */
function wallGapMm(room: RoomSize, shape: Polygon): number {
  return Math.min(...shape.flatMap((point) => [point.x, point.y, room.widthMm - point.x, room.depthMm - point.y]));
}

function clearanceProblems(room: FitRoom, item: LayoutItem, shape: Polygon, fixtures: FixtureSolid[], add: Add): void {
  const needed = FURNITURE[item.furnitureType].wallClearanceMm;
  const gap = wallGapMm(room, shape);
  // A footprint past the wall is already out of bounds, so only gaps inside the room count here.
  if (gap >= 0 && gap < needed) add("wall_clearance", `${item.key} needs ${needed} mm from the walls and has ${Math.round(gap)} mm.`);
  for (const heater of fixtures.filter((fixture) => fixture.kind === "radiator")) {
    const zone = boxPolygon(grow(bounds(heater.polygon), HEATER_CLEARANCE_MM));
    if (!overlaps(shape, heater.polygon) && overlaps(shape, zone)) {
      add("wall_clearance", `${item.key} stands within ${HEATER_CLEARANCE_MM} mm of the ${heater.key}.`, heater.key);
    }
  }
}

function wallProblems(room: FitRoom, item: LayoutItem, shape: Polygon, add: Add): void {
  if (wallGapMm(room, shape) > WALL_TOUCH_MM) add("no_support", `${item.key} hangs on a wall, so it needs to touch one.`);
  room.geometry.doors.forEach((door) => {
    if (overlaps(shape, openingZone(room, door, WALL_TOUCH_MM * 2)) && item.elevationMm < door.heightMm) {
      add("door_swing", `${item.key} hangs across the ${door.wall} door.`, `${door.wall} door`);
    }
  });
  room.geometry.windows.forEach((window) => {
    const crossesSill = item.elevationMm < window.sillHeightMm + window.heightMm && topMm(item) > window.sillHeightMm;
    if (crossesSill && overlaps(shape, openingZone(room, window, WALL_TOUCH_MM * 2))) {
      add("window_blocked", `${item.key} hangs across a ${window.wall} window.`, `${window.wall} window`);
    }
  });
}
