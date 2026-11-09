import { doorZone, WINDOW_CLEAR_DEPTH_MM, type FitRoom } from "@/lib/domain/fit";
import { contains, rectangle, type Polygon } from "@/lib/domain/geometry";
import { footprint, type PlanLayout } from "@/lib/domain/layout";
import type { FixtureKind, RoomWindow } from "@/lib/domain/room";

/**
 * A character map of the floor for the agent, one character per square.
 * Coordinates still decide everything. The map only helps the model see
 * where open floor is before it proposes a spot.
 */

export const FLOOR_MAP_CELL_MM = 200;

const FIXTURE_MARK: Readonly<Record<FixtureKind, string>> = {
  bed: "B",
  desk: "D",
  desk_chair: "C",
  dresser: "S",
  wardrobe: "W",
  closet: "W",
  radiator: "R",
};

export const FLOOR_MAP_LEGEND =
  "Each character is a 200 mm square. Row 1 lies along the north wall and column 1 along the west wall, so the square in row r and column c is centered at x = (c - 0.5) * 200 and y = (r - 0.5) * 200. " +
  ". open floor, B bed, D desk, C desk chair, S dresser, W wardrobe, R radiator or heater, d door swing (keep clear), w floor in front of a window (only items lower than the sill), x a placed floor item, r a placed rug.";

function windowZone(room: FitRoom, window: RoomWindow): Polygon {
  const from = window.offsetMm;
  const to = window.offsetMm + window.widthMm;
  const depth = WINDOW_CLEAR_DEPTH_MM;
  const box = {
    north: { minX: from, maxX: to, minY: 0, maxY: depth },
    south: { minX: from, maxX: to, minY: room.depthMm - depth, maxY: room.depthMm },
    west: { minX: 0, maxX: depth, minY: from, maxY: to },
    east: { minX: room.widthMm - depth, maxX: room.widthMm, minY: from, maxY: to },
  }[window.wall];
  return [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
}

export function floorMap(room: FitRoom, layout: PlanLayout): string[] {
  const columns = Math.ceil(room.widthMm / FLOOR_MAP_CELL_MM);
  const rows = Math.ceil(room.depthMm / FLOOR_MAP_CELL_MM);
  const layers: { mark: string; polygon: Polygon }[] = [
    ...room.geometry.windows.map((window) => ({ mark: "w", polygon: windowZone(room, window) })),
    ...room.geometry.doors.map((door) => ({ mark: "d", polygon: doorZone(room, door) })),
    ...layout.items.filter((item) => item.placement === "underlay").map((item) => ({ mark: "r", polygon: footprint(item) })),
    ...room.geometry.fixtures.map((fixture) => ({
      mark: FIXTURE_MARK[fixture.kind],
      polygon: rectangle(fixture.xMm, fixture.yMm, fixture.widthMm, fixture.depthMm, fixture.rotationDeg),
    })),
    ...layout.items.filter((item) => item.placement === "floor").map((item) => ({ mark: "x", polygon: footprint(item) })),
  ];
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => {
      const center = [{ x: (column + 0.5) * FLOOR_MAP_CELL_MM, y: (row + 0.5) * FLOOR_MAP_CELL_MM }];
      // Later layers win, so furniture shows over the clear zones it must stay out of.
      let mark = ".";
      for (const layer of layers) if (contains(layer.polygon, center, 0)) mark = layer.mark;
      return mark;
    }).join(""),
  );
}
