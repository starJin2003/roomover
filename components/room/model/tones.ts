import { mixHex } from "@/lib/design/contrast";
import { COLOR } from "@/lib/design/tokens";

/**
 * The room and the university's furniture use palette colors and mixes of
 * two, in matte mid neutrals. Marketplace items wear the colors read from
 * their photos, toned down to sit inside the warm palette, with a glossy
 * finish. Sky marks only the item the agent just placed.
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

export type HexColor = `#${string}`;

/** A palette tone by name, or a color already toned for the room. */
export type Paint = Tone | HexColor;

export const isHex = (paint: Paint): paint is HexColor => paint.startsWith("#");

export function paintHex(paint: Paint): string {
  return isHex(paint) ? paint : TONES[paint];
}

/** Glossy toy plastic, soft fabric, matte provided furniture and walls, or window glass. */
export type Finish = "toy" | "fabric" | "muted" | "glass";

export const SKY = COLOR.sky;

/** The listing's own colors, main color first. */
export type ItemTones = readonly [Paint, ...Paint[]];

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

/** Maps listing color words such as "black and brass" to palette tones, for items without photo swatches. */
export function tonesForColor(color: string): ItemTones {
  const tones: Tone[] = [];
  for (const phrase of color.toLowerCase().split(/,|\band\b/)) {
    const match = COLOR_WORDS.find(([pattern]) => pattern.test(phrase));
    if (match !== undefined && !tones.includes(match[1])) tones.push(match[1]);
  }
  const [first = "stone", ...rest] = tones;
  return [first, ...rest];
}

type Lab = readonly [number, number, number];

const toLinear = (channel: number) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const toChannel = (linear: number) => {
  const value = linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.max(0, linear) ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
};

/** sRGB hex to OKLab (https://bottosson.github.io/posts/oklab/). */
export function hexToOklab(hex: string): Lab {
  const [r, g, b] = [1, 3, 5].map((start) => toLinear(parseInt(hex.slice(start, start + 2), 16)));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToHex([lightness, a, b]: Lab): HexColor {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${rgb.map((channel) => toChannel(channel).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Lightness stays between graphite and Paper, so no item reads as a hole or a light. */
export const ROOM_PAINT_LIGHTNESS = [0.3, 0.92] as const;
/** Chroma keeps 62 percent of the photo's and never passes this, so the room stays calm. */
export const ROOM_PAINT_MAX_CHROMA = 0.1;
const CHROMA_SHARE = 0.62;
const PAPER_SHARE = 0.1;

/** A photo color toned for the room: lightness clamped, chroma cut, and a tenth of Paper mixed in for warmth. */
export function roomPaint(hex: string): HexColor {
  const [lightness, a, b] = hexToOklab(hex);
  const chroma = Math.hypot(a, b);
  const scale = chroma === 0 ? 0 : Math.min(CHROMA_SHARE, ROOM_PAINT_MAX_CHROMA / chroma);
  const [paperL, paperA, paperB] = hexToOklab(COLOR.paper);
  const clamped = Math.min(ROOM_PAINT_LIGHTNESS[1], Math.max(ROOM_PAINT_LIGHTNESS[0], lightness));
  return oklabToHex([
    clamped * (1 - PAPER_SHARE) + paperL * PAPER_SHARE,
    a * scale * (1 - PAPER_SHARE) + paperA * PAPER_SHARE,
    b * scale * (1 - PAPER_SHARE) + paperB * PAPER_SHARE,
  ]);
}

/** The paints for a placed item: its photo swatches when it has them, its color words otherwise. */
export function itemTones(colors: readonly { hex: string }[], color: string): ItemTones {
  const [first, ...rest] = colors.map((swatch) => roomPaint(swatch.hex));
  return first === undefined ? tonesForColor(color) : [first, ...rest];
}
