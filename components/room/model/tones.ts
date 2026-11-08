import { mixHex } from "@/lib/design/contrast";
import { COLOR } from "@/lib/design/tokens";

/**
 * Every color in the room is a palette color or a mix of two. Marketplace
 * items take the bright end (Paper, graphite, oak) with a glossy finish, the
 * university's furniture and the room itself stay in matte mid neutrals, and
 * Sky marks only the item the agent just placed.
 */
const mix = (share: number) => mixHex(COLOR.paper, COLOR.stone, share);

export const TONES = {
  paper: COLOR.paper,
  linen: mix(0.15),
  sand: mix(0.32),
  oak: mix(0.5),
  stone: COLOR.stone,
  flint: COLOR.flint,
  graphite: COLOR.key,
  ink: COLOR.ink,
  wall: mix(0.04),
  floor: mix(0.5),
  slab: COLOR.flint,
  birch: mix(0.3),
  frame: mix(0.44),
  mattress: mix(0.14),
  radiator: mix(0.18),
  fitting: mix(0.62),
  swing: mix(0.58),
} as const;

export type Tone = keyof typeof TONES;

/** Glossy toy plastic, soft fabric, matte provided furniture and walls, or window glass. */
export type Finish = "toy" | "fabric" | "muted" | "glass";

export const SKY = COLOR.sky;

/** The listing's own colors, in the order the seller wrote them. */
export type ItemTones = readonly [Tone, ...Tone[]];

// Checked in order, so "dark green" wins over "green" and "light blue" over "blue".
const COLOR_WORDS: readonly [RegExp, Tone][] = [
  [/\b(black|dark)\b/, "graphite"],
  [/\b(navy|charcoal)\b/, "flint"],
  [/\blight blue\b/, "linen"],
  [/\b(white|cream|ivory|beige|linen|frosted|clear)\b/, "paper"],
  [/\b(oak|beech|honey|tan|jute|brass|gold|mustard|yellow|orange|wood)\b/, "oak"],
  [/\b(pink|taupe)\b/, "sand"],
  [/\b(gr[ae]y|green|red|blue|teal|bronze)\b/, "stone"],
];

/** Maps a listing color such as "black and brass" to palette tones, here graphite and oak. */
export function tonesForColor(color: string): ItemTones {
  const tones: Tone[] = [];
  for (const phrase of color.toLowerCase().split(/,|\band\b/)) {
    const match = COLOR_WORDS.find(([pattern]) => pattern.test(phrase));
    if (match !== undefined && !tones.includes(match[1])) tones.push(match[1]);
  }
  const [first = "stone", ...rest] = tones;
  return [first, ...rest];
}
