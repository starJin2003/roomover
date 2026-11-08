import { doorSwing } from "@/lib/domain/fit";
import type { Door, RoomGeometry, RoomSize, RoomWindow, Wall } from "@/lib/domain/room";
import { look, slab, sphere, type Part } from "./parts";
import type { Tone } from "./tones";

/**
 * The room lifted out of its building. It stands on a slab with a cut edge,
 * with two full walls at the back and the other two cut away so the camera
 * looks in. Shell parts use room space: x east and z south from the inside
 * north west corner of the floor, y up from the floor.
 */

export const WALL_MM = 120;
export const SLAB_MM = 180;
/** Slab that reaches past the room on the cut away sides. */
export const LIP_MM = 60;
const FLOOR_LAYER_MM = 16;
const CAP_MM = 12;

const muted = (tone: Tone) => look(tone, "muted");

export interface RoomView {
  backWalls: readonly [Wall, Wall];
  /** Horizontal direction from the room toward the camera, in room space. */
  toward: { x: number; z: number };
}

const ADJACENT: Readonly<Record<Wall, readonly Wall[]>> = {
  north: ["east", "west"],
  south: ["east", "west"],
  east: ["north", "south"],
  west: ["north", "south"],
};

/**
 * Picks the corner the camera looks from. The window wall always stands at
 * the back, and the door wall joins it when the two meet. Otherwise the
 * west or north wall closes the corner.
 */
export function roomView(geometry: RoomGeometry): RoomView {
  const counts = new Map<Wall, number>();
  for (const window of geometry.windows) counts.set(window.wall, (counts.get(window.wall) ?? 0) + 1);
  const windowWall = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "north";
  const doorWall = geometry.doors[0]?.wall;
  const side = doorWall !== undefined && ADJACENT[windowWall].includes(doorWall) ? doorWall : ADJACENT[windowWall].includes("west") ? "west" : "north";
  const walls = new Set<Wall>([windowWall, side]);
  return {
    backWalls: [windowWall, side],
    toward: { x: walls.has("west") ? 1 : -1, z: walls.has("north") ? 1 : -1 },
  };
}

interface Opening {
  start: number;
  end: number;
  bottom: number;
  top: number;
}

interface WallLine {
  wall: Wall;
  /** Range along the wall, in room x for north and south walls and room z for east and west. */
  from: number;
  to: number;
  /** Center of the wall's thickness, across the wall. */
  across: number;
  /** +1 when the room lies on the positive side of the wall. */
  inward: 1 | -1;
}

const runsAlongX = (wall: Wall) => wall === "north" || wall === "south";

function piece(line: WallLine, start: number, end: number, bottom: number, top: number, depth: number, tone: Tone, acrossShift = 0): Part {
  const length = end - start;
  const middle = (start + end) / 2;
  const across = line.across + acrossShift * line.inward;
  return runsAlongX(line.wall)
    ? slab([length, top - bottom, depth], middle, bottom, across, 3, muted(tone))
    : slab([depth, top - bottom, length], across, bottom, middle, 3, muted(tone));
}

function wallParts(line: WallLine, height: number, openings: Opening[]): Part[] {
  const parts: Part[] = [];
  const body = height - CAP_MM;
  let cursor = line.from;
  for (const opening of [...openings].sort((a, b) => a.start - b.start)) {
    if (opening.start > cursor) parts.push(piece(line, cursor, opening.start, 0, body, WALL_MM, "wall"));
    if (opening.bottom > 0) parts.push(piece(line, opening.start, opening.end, 0, opening.bottom, WALL_MM, "wall"));
    if (opening.top < body) parts.push(piece(line, opening.start, opening.end, opening.top, body, WALL_MM, "wall"));
    cursor = opening.end;
  }
  if (line.to > cursor) parts.push(piece(line, cursor, line.to, 0, body, WALL_MM, "wall"));
  parts.push(piece(line, line.from, line.to, body, height, WALL_MM, "slab"));
  return parts;
}

function windowParts(line: WallLine, window: RoomWindow): Part[] {
  const frame = 50;
  const depth = 80;
  const start = window.offsetMm;
  const end = start + window.widthMm;
  const bottom = window.sillHeightMm;
  const top = bottom + window.heightMm;
  const middle = (start + end) / 2;
  const glassLook = look("linen", "glass");
  const parts = [
    piece(line, start, start + frame, bottom, top, depth, "paper"),
    piece(line, end - frame, end, bottom, top, depth, "paper"),
    piece(line, start, end, top - frame, top, depth, "paper"),
    piece(line, start, end, bottom, bottom + frame, depth, "paper"),
    piece(line, middle - 15, middle + 15, bottom + frame, top - frame, 50, "paper"),
    piece(line, start + frame, end - frame, bottom + window.heightMm * 0.62 - 15, bottom + window.heightMm * 0.62 + 15, 50, "paper"),
    piece(line, start - 50, end + 50, bottom - 22, bottom, 70, "paper", WALL_MM / 2),
  ];
  const glass = piece(line, start + frame, end - frame, bottom + frame, top - frame, 6, "linen");
  return [...parts, { ...glass, look: glassLook }];
}

function doorParts(line: WallLine, door: Door, room: RoomSize): Part[] {
  const start = door.offsetMm;
  const end = start + door.widthMm;
  const jamb = 45;
  const parts = [
    piece(line, start - jamb, start, 0, door.heightMm + jamb, WALL_MM + 24, "paper"),
    piece(line, end, end + jamb, 0, door.heightMm + jamb, WALL_MM + 24, "paper"),
    piece(line, start, end, door.heightMm, door.heightMm + jamb, WALL_MM + 24, "paper"),
    piece(line, start + 6, end - 6, 6, door.heightMm - 6, 40, "sand"),
  ];
  const { hinge } = doorSwing(room, door);
  const hingeAlong = runsAlongX(door.wall) ? hinge.x : hinge.y;
  const latch = hingeAlong <= start + 1 ? end - 80 : start + 80;
  const across = line.across + line.inward * 44;
  const handle: readonly [number, number, number] = runsAlongX(door.wall) ? [latch, 1000, across] : [across, 1000, latch];
  return [...parts, sphere(24, handle, muted("fitting"))];
}

function threshold(door: Door, room: RoomSize): Part {
  const start = door.offsetMm;
  const end = start + door.widthMm;
  const depth = LIP_MM + 40;
  const middle = (start + end) / 2;
  switch (door.wall) {
    case "north":
      return slab([door.widthMm, 8, depth], middle, 0, 40 - depth / 2, 2, muted("sand"));
    case "south":
      return slab([door.widthMm, 8, depth], middle, 0, room.depthMm - 40 + depth / 2, 2, muted("sand"));
    case "west":
      return slab([depth, 8, door.widthMm], 40 - depth / 2, 0, middle, 2, muted("sand"));
    case "east":
      return slab([depth, 8, door.widthMm], room.widthMm - 40 + depth / 2, 0, middle, 2, muted("sand"));
  }
}

export interface ShellRoom extends RoomSize {
  geometry: RoomGeometry;
}

/** Room space bounds of the slab, for the camera and the slab's shadow. */
export function slabBounds(room: RoomSize, view: RoomView) {
  const back = new Set(view.backWalls);
  return {
    minX: back.has("west") ? -WALL_MM : -LIP_MM,
    maxX: room.widthMm + (back.has("east") ? WALL_MM : LIP_MM),
    minZ: back.has("north") ? -WALL_MM : -LIP_MM,
    maxZ: room.depthMm + (back.has("south") ? WALL_MM : LIP_MM),
  };
}

export function buildShell(room: ShellRoom, view: RoomView): Part[] {
  const area = slabBounds(room, view);
  const sizeX = area.maxX - area.minX;
  const sizeZ = area.maxZ - area.minZ;
  const centerX = (area.minX + area.maxX) / 2;
  const centerZ = (area.minZ + area.maxZ) / 2;
  const parts: Part[] = [
    slab([sizeX, SLAB_MM - FLOOR_LAYER_MM, sizeZ], centerX, -SLAB_MM, centerZ, 36, muted("slab")),
    slab([sizeX, FLOOR_LAYER_MM, sizeZ], centerX, -FLOOR_LAYER_MM, centerZ, 6, muted("floor")),
  ];

  const [first, second] = runsAlongX(view.backWalls[0]) ? view.backWalls : [view.backWalls[1], view.backWalls[0]];
  const lines: WallLine[] = [
    {
      wall: first,
      from: area.minX,
      to: area.maxX,
      across: first === "north" ? -WALL_MM / 2 : room.depthMm + WALL_MM / 2,
      inward: first === "north" ? 1 : -1,
    },
    {
      wall: second,
      from: first === "north" ? 0 : area.minZ,
      to: first === "north" ? area.maxZ : room.depthMm,
      across: second === "west" ? -WALL_MM / 2 : room.widthMm + WALL_MM / 2,
      inward: second === "west" ? 1 : -1,
    },
  ];

  for (const line of lines) {
    const windows = room.geometry.windows.filter((window) => window.wall === line.wall);
    const doors = room.geometry.doors.filter((door) => door.wall === line.wall);
    const openings: Opening[] = [
      ...windows.map((window) => ({ start: window.offsetMm, end: window.offsetMm + window.widthMm, bottom: window.sillHeightMm, top: window.sillHeightMm + window.heightMm })),
      ...doors.map((door) => ({ start: door.offsetMm, end: door.offsetMm + door.widthMm, bottom: 0, top: door.heightMm })),
    ];
    parts.push(...wallParts(line, room.ceilingHeightMm, openings));
    for (const window of windows) parts.push(...windowParts(line, window));
    for (const door of doors) parts.push(...doorParts(line, door, room));
  }

  const backWalls = new Set(view.backWalls);
  for (const door of room.geometry.doors.filter((candidate) => !backWalls.has(candidate.wall))) parts.push(threshold(door, room));
  return parts;
}
