import type { Finish, Tone } from "./tones";

/**
 * A model is a list of parts in millimeters. Each part is a rounded box, a
 * rounded cylinder, a sphere, or a turned profile, placed by its center in
 * the model's own space: x across the width, y up from the floor, and z
 * toward the model's front. The renderer turns parts into geometry, merges
 * them by material, and scales them to meters.
 */

export type Vec3 = readonly [number, number, number];

export interface Look {
  tone: Tone;
  finish: Finish;
}

interface PartBase {
  at: Vec3;
  /** Euler angles in degrees, in the three.js XYZ order. */
  rotation?: Vec3;
  look: Look;
}

export type Part =
  | (PartBase & { shape: "box"; size: Vec3; radius: number })
  | (PartBase & { shape: "cylinder"; radius: number; radiusTop: number; height: number; bevel: number })
  | (PartBase & { shape: "sphere"; radius: number })
  /** A turned profile. `profile` is [radius, height] pairs from the bottom center up. */
  | (PartBase & { shape: "lathe"; profile: readonly (readonly [number, number])[] });

export const look = (tone: Tone, finish: Finish): Look => ({ tone, finish });

export function box(size: Vec3, at: Vec3, radius: number, appearance: Look, rotation?: Vec3): Part {
  const limit = Math.min(...size) / 2 - 0.5;
  return { shape: "box", size, at, radius: Math.max(0.5, Math.min(radius, limit)), look: appearance, ...(rotation ? { rotation } : {}) };
}

/** A box resting on y = bottom, centered on x and z. */
export function slab(size: Vec3, x: number, bottom: number, z: number, radius: number, appearance: Look): Part {
  return box(size, [x, bottom + size[1] / 2, z], radius, appearance);
}

export function cylinder(
  radius: number,
  height: number,
  at: Vec3,
  appearance: Look,
  options: { radiusTop?: number; bevel?: number; rotation?: Vec3 } = {},
): Part {
  const radiusTop = options.radiusTop ?? radius;
  const bevel = Math.max(0, Math.min(options.bevel ?? 2, Math.min(radius, radiusTop) - 0.5, height / 2 - 0.5));
  return { shape: "cylinder", radius, radiusTop, height, at, bevel, look: appearance, ...(options.rotation ? { rotation: options.rotation } : {}) };
}

export function sphere(radius: number, at: Vec3, appearance: Look): Part {
  return { shape: "sphere", radius, at, look: appearance };
}

/** A straight round rod between two points in the model's xy plane. */
export function rod(from: readonly [number, number], to: readonly [number, number], z: number, radius: number, appearance: Look): Part {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI - 90;
  return cylinder(radius, length, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, z], appearance, { rotation: [0, 0, angle], bevel: radius * 0.6 });
}

export function lathe(profile: readonly (readonly [number, number])[], at: Vec3, appearance: Look): Part {
  return { shape: "lathe", profile, at, look: appearance };
}

export interface Extent {
  min: Vec3;
  max: Vec3;
}

/**
 * The box a part fills, ignoring rounding, which only removes material.
 * Rotated parts report the box around their turned corners.
 */
export function partExtent(part: Part): Extent {
  const half: Vec3 =
    part.shape === "box"
      ? [part.size[0] / 2, part.size[1] / 2, part.size[2] / 2]
      : part.shape === "cylinder"
        ? [Math.max(part.radius, part.radiusTop), part.height / 2, Math.max(part.radius, part.radiusTop)]
        : part.shape === "sphere"
          ? [part.radius, part.radius, part.radius]
          : latheHalf(part.profile);
  const center: Vec3 = part.shape === "lathe" ? [part.at[0], part.at[1] + half[1], part.at[2]] : part.at;
  const corners = rotatedCorners(half, part.rotation ?? [0, 0, 0]);
  const min = [0, 1, 2].map((axis) => center[axis] + Math.min(...corners.map((corner) => corner[axis])));
  const max = [0, 1, 2].map((axis) => center[axis] + Math.max(...corners.map((corner) => corner[axis])));
  return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
}

/** The box around a whole model. */
export function modelExtent(parts: readonly Part[]): Extent {
  const extents = parts.map(partExtent);
  const pick = (choose: (...values: number[]) => number, key: "min" | "max") =>
    [0, 1, 2].map((axis) => choose(...extents.map((extent) => extent[key][axis]))) as unknown as Vec3;
  return { min: pick(Math.min, "min"), max: pick(Math.max, "max") };
}

function latheHalf(profile: readonly (readonly [number, number])[]): Vec3 {
  const radius = Math.max(...profile.map(([r]) => r));
  const height = Math.max(...profile.map(([, y]) => y));
  return [radius, height / 2, radius];
}

function rotatedCorners(half: Vec3, rotation: Vec3): Vec3[] {
  const [ax, ay, az] = rotation.map((degrees) => (degrees * Math.PI) / 180);
  const corners: Vec3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        // three.js applies an XYZ Euler as Z first, then Y, then X.
        let [x, y, z] = [sx * half[0], sy * half[1], sz * half[2]];
        [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
        [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
        [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
        corners.push([x, y, z]);
      }
    }
  }
  return corners;
}
