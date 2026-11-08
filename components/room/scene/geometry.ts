import { BufferGeometry, Euler, LatheGeometry, Matrix4, Quaternion, SphereGeometry, Vector2, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Look, Part } from "../model/parts";

/** Scene units are meters. Models are written in millimeters. */
export const MM = 0.001;

const cache = new Map<string, BufferGeometry>();

function cached(key: string, create: () => BufferGeometry): BufferGeometry {
  let geometry = cache.get(key);
  if (geometry === undefined) {
    geometry = create();
    cache.set(key, geometry);
  }
  return geometry;
}

const round = (value: number) => Math.round(value * 10) / 10;

/** A cylinder turned from a profile with a quarter round at both rims, so it catches light like a toy. */
function roundedCylinder(radius: number, radiusTop: number, height: number, bevel: number): BufferGeometry {
  const b = Math.max(0.4, bevel);
  const steps = b > 6 ? 5 : 3;
  const points = [new Vector2(0, -height / 2)];
  for (let index = 0; index <= steps; index++) {
    const angle = -Math.PI / 2 + (Math.PI / 2) * (index / steps);
    points.push(new Vector2(radius - b + b * Math.cos(angle), -height / 2 + b + b * Math.sin(angle)));
  }
  for (let index = 0; index <= steps; index++) {
    const angle = (Math.PI / 2) * (index / steps);
    points.push(new Vector2(radiusTop - b + b * Math.cos(angle), height / 2 - b + b * Math.sin(angle)));
  }
  points.push(new Vector2(0, height / 2));
  const segments = Math.max(radius, radiusTop) > 120 ? 40 : Math.max(radius, radiusTop) > 40 ? 28 : 14;
  return new LatheGeometry(
    points.map((point) => point.multiplyScalar(MM)),
    segments,
  );
}

function baseGeometry(part: Part): BufferGeometry {
  switch (part.shape) {
    case "box": {
      const [w, h, d] = part.size.map(round);
      const radius = round(part.radius);
      return cached(`box:${w}:${h}:${d}:${radius}`, () => new RoundedBoxGeometry(w * MM, h * MM, d * MM, radius > 18 ? 4 : 2, radius * MM));
    }
    case "cylinder": {
      const key = `cyl:${round(part.radius)}:${round(part.radiusTop)}:${round(part.height)}:${round(part.bevel)}`;
      return cached(key, () => roundedCylinder(part.radius, part.radiusTop, part.height, part.bevel));
    }
    case "sphere":
      return cached(`sphere:${round(part.radius)}`, () => new SphereGeometry(part.radius * MM, 16, 12));
    case "lathe": {
      const key = `lathe:${part.profile.map(([r, y]) => `${round(r)},${round(y)}`).join(";")}`;
      const radius = Math.max(...part.profile.map(([r]) => r));
      return cached(key, () => new LatheGeometry(part.profile.map(([r, y]) => new Vector2(r * MM, y * MM)), radius > 120 ? 40 : 24));
    }
  }
}

const matrix = new Matrix4();
const rotation = new Quaternion();
const euler = new Euler();
const position = new Vector3();
const unit = new Vector3(1, 1, 1);

/** RoundedBoxGeometry is built without an index, so every part goes flat before merging. */
function placed(part: Part): BufferGeometry {
  const base = baseGeometry(part);
  const geometry = base.index === null ? base.clone() : base.toNonIndexed();
  const [rx, ry, rz] = part.rotation ?? [0, 0, 0];
  rotation.setFromEuler(euler.set((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180, "XYZ"));
  position.set(part.at[0] * MM, part.at[1] * MM, part.at[2] * MM);
  geometry.applyMatrix4(matrix.compose(position, rotation, unit));
  return geometry;
}

export const lookKey = (appearance: Look) => `${appearance.tone}:${appearance.finish}`;

export interface MergedMesh {
  key: string;
  look: Look;
  geometry: BufferGeometry;
}

/** One geometry per material, so a whole model draws in a few calls. */
export function mergeParts(parts: readonly Part[]): MergedMesh[] {
  const groups = new Map<string, { look: Look; geometries: BufferGeometry[] }>();
  for (const part of parts) {
    const key = lookKey(part.look);
    const group = groups.get(key) ?? { look: part.look, geometries: [] };
    group.geometries.push(placed(part));
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => {
    const geometry = mergeGeometries(group.geometries, false);
    for (const piece of group.geometries) piece.dispose();
    if (geometry === null) throw new Error(`Parts for ${key} could not be merged.`);
    geometry.computeBoundingSphere();
    return { key, look: group.look, geometry };
  });
}
