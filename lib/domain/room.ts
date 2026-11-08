import { z } from "zod";

/**
 * Room geometry in integer millimeters on the floor plan. The origin is the
 * inside corner where the north and west walls meet. x runs east across the
 * room width and y runs south across the room depth.
 *
 * Openings sit on a wall at an offset from the wall's start. The north and
 * south walls start at their west end, and the east and west walls start at
 * their north end. Fixtures are placed by the center of their footprint, and
 * a quarter turn swaps their width and depth on the floor. At 0 degrees a
 * fixture's front faces south, and rotation turns clockwise as seen from
 * above, so 90 faces west. A bed's front is its foot.
 */

export const WALLS = ["north", "east", "south", "west"] as const;
export type Wall = (typeof WALLS)[number];

export const QUARTER_TURNS = [0, 90, 180, 270] as const;
export type QuarterTurn = (typeof QUARTER_TURNS)[number];

export const FIXTURE_KINDS = ["bed", "desk", "desk_chair", "dresser", "wardrobe", "closet", "radiator"] as const;
export type FixtureKind = (typeof FIXTURE_KINDS)[number];

const lengthMm = z.number().int().positive();
const offsetMm = z.number().int().nonnegative();
export const quarterTurnSchema = z.literal(QUARTER_TURNS);

export const doorSchema = z.strictObject({
  wall: z.enum(WALLS),
  offsetMm,
  widthMm: lengthMm,
  heightMm: lengthMm,
  swing: z.enum(["in", "out"]),
  /** Hinge side, seen from inside the room. */
  hinge: z.enum(["left", "right"]),
});

export const windowSchema = z.strictObject({
  wall: z.enum(WALLS),
  offsetMm,
  widthMm: lengthMm,
  heightMm: lengthMm,
  sillHeightMm: offsetMm,
});

/** Furniture and fixed elements the university provides. They stay in the room. */
export const fixtureSchema = z.strictObject({
  kind: z.enum(FIXTURE_KINDS),
  label: z.string().min(1),
  xMm: offsetMm,
  yMm: offsetMm,
  widthMm: lengthMm,
  depthMm: lengthMm,
  heightMm: lengthMm,
  rotationDeg: quarterTurnSchema,
});

export const roomGeometrySchema = z.strictObject({
  doors: z.array(doorSchema).min(1),
  windows: z.array(windowSchema),
  fixtures: z.array(fixtureSchema),
});

export type Door = z.infer<typeof doorSchema>;
export type RoomWindow = z.infer<typeof windowSchema>;
export type Fixture = z.infer<typeof fixtureSchema>;
export type RoomGeometry = z.infer<typeof roomGeometrySchema>;

export interface RoomSize {
  widthMm: number;
  depthMm: number;
  ceilingHeightMm: number;
}

export function wallLengthMm(wall: Wall, room: RoomSize): number {
  return wall === "north" || wall === "south" ? room.widthMm : room.depthMm;
}

/** Footprint on the floor as a box from (minX, minY) to (maxX, maxY). */
export function fixtureFootprint(fixture: Fixture): { minX: number; minY: number; maxX: number; maxY: number } {
  const turned = fixture.rotationDeg === 90 || fixture.rotationDeg === 270;
  const spanX = turned ? fixture.depthMm : fixture.widthMm;
  const spanY = turned ? fixture.widthMm : fixture.depthMm;
  return {
    minX: fixture.xMm - spanX / 2,
    minY: fixture.yMm - spanY / 2,
    maxX: fixture.xMm + spanX / 2,
    maxY: fixture.yMm + spanY / 2,
  };
}

/**
 * Lists every opening that runs past its wall or above the ceiling and every
 * fixture that leaves the floor or the ceiling height. An empty list means
 * the geometry fits the room.
 */
export function geometryProblems(geometry: RoomGeometry, room: RoomSize): string[] {
  const problems: string[] = [];
  geometry.doors.forEach((door, index) => {
    if (door.offsetMm + door.widthMm > wallLengthMm(door.wall, room)) {
      problems.push(`door ${index} runs past the ${door.wall} wall`);
    }
    if (door.heightMm > room.ceilingHeightMm) problems.push(`door ${index} is taller than the ceiling`);
  });
  geometry.windows.forEach((window, index) => {
    if (window.offsetMm + window.widthMm > wallLengthMm(window.wall, room)) {
      problems.push(`window ${index} runs past the ${window.wall} wall`);
    }
    if (window.sillHeightMm + window.heightMm > room.ceilingHeightMm) {
      problems.push(`window ${index} rises above the ceiling`);
    }
  });
  geometry.fixtures.forEach((fixture) => {
    const box = fixtureFootprint(fixture);
    if (box.minX < 0 || box.minY < 0 || box.maxX > room.widthMm || box.maxY > room.depthMm) {
      problems.push(`${fixture.label} leaves the floor`);
    }
    if (fixture.heightMm > room.ceilingHeightMm) problems.push(`${fixture.label} is taller than the ceiling`);
  });
  return problems;
}
