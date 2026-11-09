import { bounds, contains, rectangle, type Point, type Polygon } from "./geometry";
import type { Door, RoomGeometry, RoomSize } from "./room";

/**
 * The egress check behind hall rule 2.2: a clear path at least 915 mm wide
 * from each bed to the door. The floor is cut into 50 mm cells, and a cell can
 * carry the middle of the path when every wall and obstacle stands at least
 * half the path width away. A bed passes when a chain of such cells joins the
 * floor beside one of its open sides to the floor inside the door.
 */

export const EGRESS_PATH_MM = 915;
const CELL_MM = 50;
/** A bed side closer than this to a wall is treated as against the wall. */
const SIDE_AGAINST_WALL_MM = 300;
/** Cells in front of a bed side or a door within this extra distance count as the start or the goal. */
const REACH_MM = CELL_MM * 2.5;

export interface EgressRoom extends RoomSize {
  geometry: RoomGeometry;
}

export interface BedEgress {
  bed: string;
  reachable: boolean;
}

interface Grid {
  columns: number;
  rows: number;
  center: (column: number, row: number) => Point;
}

function grid(room: RoomSize): Grid {
  const columns = Math.floor(room.widthMm / CELL_MM);
  const rows = Math.floor(room.depthMm / CELL_MM);
  const offsetX = (room.widthMm - columns * CELL_MM) / 2;
  const offsetY = (room.depthMm - rows * CELL_MM) / 2;
  return {
    columns,
    rows,
    center: (column, row) => ({ x: offsetX + (column + 0.5) * CELL_MM, y: offsetY + (row + 0.5) * CELL_MM }),
  };
}

function segmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Zero inside the convex polygon, otherwise the distance to its nearest edge. */
function polygonDistance(point: Point, polygon: Polygon): number {
  if (contains(polygon, [point], 0)) return 0;
  let nearest = Infinity;
  polygon.forEach((corner, index) => {
    nearest = Math.min(nearest, segmentDistance(point, corner, polygon[(index + 1) % polygon.length]));
  });
  return nearest;
}

/** Clearance from walls and the provided furniture, which never moves, so it is computed once per room. */
const fixedClearance = new WeakMap<RoomGeometry, Float64Array>();

function fixedField(room: EgressRoom, cells: Grid): Float64Array {
  const cached = fixedClearance.get(room.geometry);
  if (cached !== undefined && cached.length === cells.columns * cells.rows) return cached;
  const fixtures = room.geometry.fixtures.map((fixture) => rectangle(fixture.xMm, fixture.yMm, fixture.widthMm, fixture.depthMm, fixture.rotationDeg));
  const field = new Float64Array(cells.columns * cells.rows);
  for (let row = 0; row < cells.rows; row++) {
    for (let column = 0; column < cells.columns; column++) {
      const point = cells.center(column, row);
      let clearance = Math.min(point.x, point.y, room.widthMm - point.x, room.depthMm - point.y);
      for (const fixture of fixtures) clearance = Math.min(clearance, polygonDistance(point, fixture));
      field[row * cells.columns + column] = clearance;
    }
  }
  fixedClearance.set(room.geometry, field);
  return field;
}

/** Cells that can carry the middle of the path, with the obstacles placed by the student marked off. */
function openCells(room: EgressRoom, cells: Grid, obstacles: readonly Polygon[], half: number): Uint8Array {
  const field = fixedField(room, cells);
  const open = new Uint8Array(field.length);
  for (let index = 0; index < field.length; index++) open[index] = field[index] >= half ? 1 : 0;
  for (const obstacle of obstacles) {
    const box = bounds(obstacle);
    const fromColumn = Math.max(0, Math.floor((box.minX - half) / CELL_MM) - 1);
    const toColumn = Math.min(cells.columns - 1, Math.ceil((box.maxX + half) / CELL_MM) + 1);
    const fromRow = Math.max(0, Math.floor((box.minY - half) / CELL_MM) - 1);
    const toRow = Math.min(cells.rows - 1, Math.ceil((box.maxY + half) / CELL_MM) + 1);
    for (let row = fromRow; row <= toRow; row++) {
      for (let column = fromColumn; column <= toColumn; column++) {
        const index = row * cells.columns + column;
        if (open[index] === 1 && polygonDistance(cells.center(column, row), obstacle) < half) open[index] = 0;
      }
    }
  }
  return open;
}

/** The doorway's span along its wall and the distance into the room, for a point. */
function doorFrame(room: RoomSize, door: Door, point: Point): { along: number; depth: number } {
  switch (door.wall) {
    case "north":
      return { along: point.x, depth: point.y };
    case "south":
      return { along: point.x, depth: room.depthMm - point.y };
    case "west":
      return { along: point.y, depth: point.x };
    case "east":
      return { along: point.y, depth: room.widthMm - point.x };
  }
}

function isGoal(room: RoomSize, doors: readonly Door[], point: Point, half: number): boolean {
  return doors.some((door) => {
    const { along, depth } = doorFrame(room, door, point);
    return along >= door.offsetMm && along <= door.offsetMm + door.widthMm && depth <= half + REACH_MM;
  });
}

interface Side {
  from: Point;
  to: Point;
  /** Unit normal pointing away from the bed. */
  out: Point;
}

/** The bed's two long sides and its foot, skipping any side pushed against a wall. The head stays out. */
function openSides(room: RoomSize, polygon: Polygon): Side[] {
  const center = polygon.reduce((sum, point) => ({ x: sum.x + point.x / polygon.length, y: sum.y + point.y / polygon.length }), { x: 0, y: 0 });
  // Corners run back left, back right, front right, front left, and a bed's front is its foot.
  return [1, 2, 3]
    .map((index) => {
      const from = polygon[index];
      const to = polygon[(index + 1) % polygon.length];
      const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      const length = Math.hypot(middle.x - center.x, middle.y - center.y);
      return { from, to, middle, out: { x: (middle.x - center.x) / length, y: (middle.y - center.y) / length } };
    })
    .filter(({ middle }) => Math.min(middle.x, middle.y, room.widthMm - middle.x, room.depthMm - middle.y) > SIDE_AGAINST_WALL_MM)
    .map(({ from, to, out }) => ({ from, to, out }));
}

function isStart(sides: readonly Side[], point: Point, half: number): boolean {
  return sides.some(({ from, to, out }) => {
    const distance = (point.x - from.x) * out.x + (point.y - from.y) * out.y;
    if (distance < half - 1 || distance > half + REACH_MM) return false;
    const along = { x: to.x - from.x, y: to.y - from.y };
    const length = Math.hypot(along.x, along.y);
    const t = ((point.x - from.x) * along.x + (point.y - from.y) * along.y) / (length * length);
    return t >= 0 && t <= 1;
  });
}

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * Whether each provided bed reaches a door along a path `pathWidthMm` wide,
 * with `obstacles` (the student's floor items) standing in the room.
 */
export function bedEgress(room: EgressRoom, obstacles: readonly Polygon[], pathWidthMm = EGRESS_PATH_MM): BedEgress[] {
  const cells = grid(room);
  const half = pathWidthMm / 2;
  const open = openCells(room, cells, obstacles, half);
  const goal = new Uint8Array(open.length);
  for (let row = 0; row < cells.rows; row++) {
    for (let column = 0; column < cells.columns; column++) {
      const index = row * cells.columns + column;
      if (open[index] === 1 && isGoal(room, room.geometry.doors, cells.center(column, row), half)) goal[index] = 1;
    }
  }

  return room.geometry.fixtures
    .filter((fixture) => fixture.kind === "bed")
    .map((bed) => {
      const sides = openSides(room, rectangle(bed.xMm, bed.yMm, bed.widthMm, bed.depthMm, bed.rotationDeg));
      const seen = new Uint8Array(open.length);
      const queue: number[] = [];
      for (let row = 0; row < cells.rows; row++) {
        for (let column = 0; column < cells.columns; column++) {
          const index = row * cells.columns + column;
          if (open[index] === 1 && isStart(sides, cells.center(column, row), half)) {
            seen[index] = 1;
            queue.push(index);
          }
        }
      }
      let reachable = false;
      for (let head = 0; head < queue.length && !reachable; head++) {
        const index = queue[head];
        if (goal[index] === 1) reachable = true;
        const column = index % cells.columns;
        const row = Math.floor(index / cells.columns);
        for (const [dx, dy] of NEIGHBORS) {
          const nextColumn = column + dx;
          const nextRow = row + dy;
          if (nextColumn < 0 || nextRow < 0 || nextColumn >= cells.columns || nextRow >= cells.rows) continue;
          const next = nextRow * cells.columns + nextColumn;
          if (open[next] === 1 && seen[next] === 0) {
            seen[next] = 1;
            queue.push(next);
          }
        }
      }
      return { bed: bed.label.toLowerCase(), reachable };
    });
}

