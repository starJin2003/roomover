import { Color, DataTexture, LinearFilter, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, type Material } from "three";
import { COLOR } from "@/lib/design/tokens";
import type { Look } from "../model/parts";
import { paintHex, SKY, TONES } from "../model/tones";

/**
 * One material per tone and finish, shared by every mesh in the room. Toy
 * plastic carries a clear coat like the keycaps in the reference, fabric and
 * the provided furniture stay matte, and nothing glows.
 */
const materials = new Map<string, Material>();

function create({ tone, finish }: Look): Material {
  const color = new Color(paintHex(tone));
  switch (finish) {
    case "toy":
      return new MeshPhysicalMaterial({ color, roughness: 0.46, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.3 });
    case "fabric":
      return new MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 });
    case "muted":
      return new MeshStandardMaterial({ color, roughness: 0.8, metalness: 0 });
    case "glass":
      return new MeshStandardMaterial({ color, roughness: 0.35, metalness: 0, transparent: true, opacity: 0.5, depthWrite: false });
  }
}

export function materialFor(look: Look): Material {
  const key = `${look.tone}:${look.finish}`;
  let material = materials.get(key);
  if (material === undefined) {
    material = create(look);
    materials.set(key, material);
  }
  return material;
}

/** Flat Sky for the ring under the item the agent just placed. Unlit, so it reads as a mark. */
export const ringMaterial = new MeshBasicMaterial({ color: new Color(SKY), transparent: true, depthWrite: false, toneMapped: false });

/** The outline under an item the student has selected to move. */
export const selectedRingMaterial = new MeshBasicMaterial({ color: new Color(COLOR.flint), transparent: true, depthWrite: false, toneMapped: false });

/** The quiet outline that stays under a new item from Channel3, which the student buys from a retailer. */
export const newItemRingMaterial = new MeshBasicMaterial({ color: new Color(COLOR.stone), transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false });

/** The outline under an item held over a spot that fails the fit check. */
export const invalidRingMaterial = new MeshBasicMaterial({ color: new Color(COLOR.brick), transparent: true, depthWrite: false, toneMapped: false });

const SHADOW_SIZE = 64;

/**
 * A soft rounded square, drawn from its distance field so it needs no canvas
 * filter support. Planes under items stretch it to their footprint.
 */
function contactShadowTexture(): DataTexture {
  const data = new Uint8Array(SHADOW_SIZE * SHADOW_SIZE * 4);
  const half = 0.3;
  const corner = 0.16;
  const soft = 0.2;
  for (let y = 0; y < SHADOW_SIZE; y++) {
    for (let x = 0; x < SHADOW_SIZE; x++) {
      const u = Math.abs((x + 0.5) / SHADOW_SIZE - 0.5);
      const v = Math.abs((y + 0.5) / SHADOW_SIZE - 0.5);
      const qx = Math.max(u - (half - corner), 0);
      const qy = Math.max(v - (half - corner), 0);
      const distance = Math.hypot(qx, qy) + Math.min(Math.max(u - (half - corner), v - (half - corner)), 0) - corner;
      const strength = Math.min(1, Math.max(0, 1 - (distance + soft * 0.35) / soft));
      const index = (y * SHADOW_SIZE + x) * 4;
      data.set([255, 255, 255, Math.round(strength * strength * 255)], index);
    }
  }
  const texture = new DataTexture(data, SHADOW_SIZE, SHADOW_SIZE);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

let shadowTexture: DataTexture | undefined;

export function contactShadowMaterial(opacity: number): MeshBasicMaterial {
  shadowTexture ??= contactShadowTexture();
  return new MeshBasicMaterial({ color: new Color(TONES.ink), map: shadowTexture, transparent: true, opacity, depthWrite: false, toneMapped: false });
}
