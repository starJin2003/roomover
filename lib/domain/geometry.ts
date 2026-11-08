/**
 * Plan geometry in millimeters for the fit check. Points use the room
 * coordinates from `room.ts`, with x east and y south. Every polygon here is
 * convex, so the separating axis test decides overlap.
 */

export interface Point {
  x: number;
  y: number;
}

export type Polygon = readonly Point[];

/**
 * The rectangle a footprint covers, centered on (cx, cy). Rotation turns
 * clockwise as seen from above, so a quarter turn swaps width and depth.
 */
export function rectangle(cx: number, cy: number, width: number, depth: number, rotationDeg: number): Polygon {
  const angle = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const halfW = width / 2;
  const halfD = depth / 2;
  return [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ].map(([x, y]) => ({ x: cx + snap(x * cos - y * sin), y: cy + snap(x * sin + y * cos) }));
}

/** A regular polygon drawn around the circle, so it never reports less area than the circle covers. */
export function circle(cx: number, cy: number, radius: number, sides = 16): Polygon {
  const outer = radius / Math.cos(Math.PI / sides);
  return Array.from({ length: sides }, (_, index) => {
    const angle = (index / sides) * Math.PI * 2;
    return { x: cx + snap(outer * Math.cos(angle)), y: cy + snap(outer * Math.sin(angle)) };
  });
}

/**
 * The quarter disc a door leaf sweeps, from the hinge point between the two
 * unit directions `closed` (along the wall) and `open` (into the room). The
 * arc is drawn with tangent edges, so the polygon covers the whole disc.
 */
export function quarterDisc(hinge: Point, radius: number, closed: Point, open: Point, steps = 8): Polygon {
  const start = Math.atan2(closed.y, closed.x);
  let sweep = Math.atan2(open.y, open.x) - start;
  if (sweep > Math.PI) sweep -= Math.PI * 2;
  if (sweep < -Math.PI) sweep += Math.PI * 2;
  const step = sweep / steps;
  const point = (angle: number, distance: number) => ({
    x: hinge.x + snap(distance * Math.cos(angle)),
    y: hinge.y + snap(distance * Math.sin(angle)),
  });
  const tangent = Array.from({ length: steps }, (_, index) => point(start + step * (index + 0.5), radius / Math.cos(step / 2)));
  return [hinge, point(start, radius), ...tangent, point(start + sweep, radius)];
}

/** Grows an axis aligned box by a margin on every side. */
export function grow(box: Bounds, margin: number): Bounds {
  return { minX: box.minX - margin, minY: box.minY - margin, maxX: box.maxX + margin, maxY: box.maxY + margin };
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bounds(polygon: Polygon): Bounds {
  return {
    minX: Math.min(...polygon.map((point) => point.x)),
    minY: Math.min(...polygon.map((point) => point.y)),
    maxX: Math.max(...polygon.map((point) => point.x)),
    maxY: Math.max(...polygon.map((point) => point.y)),
  };
}

export function boxPolygon(box: Bounds): Polygon {
  return [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
}

/**
 * True when the polygons share more than `tolerance` millimeters along every
 * axis. Shapes that only touch, or overlap by less than the tolerance, pass.
 */
export function overlaps(a: Polygon, b: Polygon, tolerance = 1): boolean {
  for (const polygon of [a, b]) {
    for (let index = 0; index < polygon.length; index++) {
      const p = polygon[index];
      const q = polygon[(index + 1) % polygon.length];
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      if (length === 0) continue;
      const axis = { x: (p.y - q.y) / length, y: (q.x - p.x) / length };
      const [minA, maxA] = project(a, axis);
      const [minB, maxB] = project(b, axis);
      if (Math.min(maxA, maxB) - Math.max(minA, minB) <= tolerance) return false;
    }
  }
  return true;
}

/** True when every corner of `inner` lies inside the convex `outer`, within the tolerance. */
export function contains(outer: Polygon, inner: Polygon, tolerance = 1): boolean {
  const sign = orientation(outer);
  return inner.every((point) =>
    outer.every((p, index) => {
      const q = outer[(index + 1) % outer.length];
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      const cross = ((q.x - p.x) * (point.y - p.y) - (q.y - p.y) * (point.x - p.x)) / length;
      return cross * sign >= -tolerance;
    }),
  );
}

function project(polygon: Polygon, axis: Point): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const point of polygon) {
    const value = point.x * axis.x + point.y * axis.y;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return [min, max];
}

function orientation(polygon: Polygon): number {
  let area = 0;
  polygon.forEach((p, index) => {
    const q = polygon[(index + 1) % polygon.length];
    area += p.x * q.y - q.x * p.y;
  });
  return area >= 0 ? 1 : -1;
}

/** Rounds away floating point noise, so a quarter turn lands on whole millimeters. */
function snap(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
