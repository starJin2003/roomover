import type { ContrastUse } from "./contrast";

/**
 * Roomover's design tokens. `app/globals.css` declares the same values as
 * Tailwind theme variables, and a unit test keeps the two in step.
 *
 * The first six palette colors come from the 2024 PayPal monogram. Flint
 * exists because Stone fails AA for body text on Paper, and Brick marks
 * errors and destructive actions. Surfaces are mixes of palette colors, so
 * no new hue enters the interface.
 */
export const PALETTE = [
  { token: "paper", name: "Paper", hex: "#F6F3EE", role: "Sheets, panels, and the faces of light keys" },
  { token: "ink", name: "Ink", hex: "#14151A", role: "Text, focus rings, and the skirt of dark keys" },
  { token: "stone", name: "Stone", hex: "#8C877D", role: "Control borders and slot outlines on Paper" },
  { token: "flint", name: "Flint", hex: "#67625A", role: "Secondary text at any size" },
  { token: "navy", name: "PayPal navy", hex: "#002991", role: "PayPal cards at the moments money moves" },
  { token: "blue", name: "PayPal blue", hex: "#008CFF", role: "Fill behind Ink text once money has moved, never text" },
  { token: "sky", name: "Sky", hex: "#60CDFF", role: "The single accent in the 3D room" },
  { token: "brick", name: "Brick", hex: "#A3341E", role: "Errors, damage found at handoff, destructive keys" },
] as const;

type PaletteToken = (typeof PALETTE)[number]["token"];

export const SURFACES = [
  { token: "table", name: "Table", hex: "#E9E6E0", mix: { base: "paper", other: "stone", share: 0.12 }, role: "Page ground and the 3D room's background" },
  { token: "well", name: "Well", hex: "#EBE8E3", mix: { base: "paper", other: "stone", share: 0.1 }, role: "The current step, the current checklist row, quiet key hovers" },
  { token: "key", name: "Key", hex: "#343438", mix: { base: "ink", other: "paper", share: 0.14 }, role: "Top face of primary keys" },
  { token: "skirt", name: "Skirt", hex: "#C6C2BB", mix: { base: "paper", other: "stone", share: 0.45 }, role: "Skirt under light keys" },
  { token: "brick-skirt", name: "Brick skirt", hex: "#71291D", mix: { base: "brick", other: "ink", share: 0.35 }, role: "Skirt under destructive keys" },
] as const satisfies readonly { token: string; name: string; hex: string; mix: { base: PaletteToken; other: PaletteToken; share: number }; role: string }[];

/** PayPal requires its full color monogram to sit on white. This white appears only behind the mark. */
export const BRAND_GROUNDS = [
  { token: "paypal-ground", name: "PayPal mark ground", hex: "#FFFFFF", role: "White ground behind the PayPal monogram" },
] as const;

export type ColorToken = (typeof PALETTE)[number]["token"] | (typeof SURFACES)[number]["token"] | (typeof BRAND_GROUNDS)[number]["token"];

export const COLOR: Readonly<Record<ColorToken, string>> = Object.fromEntries(
  [...PALETTE, ...SURFACES, ...BRAND_GROUNDS].map((color) => [color.token, color.hex]),
) as Record<ColorToken, string>;

export interface ContrastPair {
  readonly foreground: ColorToken;
  readonly background: ColorToken;
  /** The strictest AA use this pair is allowed for. */
  readonly use: ContrastUse;
  readonly where: string;
}

/** Every foreground and background combination the interface uses. */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { foreground: "ink", background: "paper", use: "body", where: "Text on panels and light keys" },
  { foreground: "flint", background: "paper", use: "body", where: "Secondary text on panels" },
  { foreground: "ink", background: "table", use: "body", where: "Headings and text on the page ground" },
  { foreground: "flint", background: "table", use: "body", where: "Secondary text on the page ground" },
  { foreground: "ink", background: "well", use: "body", where: "The current step and checklist row" },
  { foreground: "flint", background: "well", use: "body", where: "Disabled key labels, secondary text in the current row" },
  { foreground: "paper", background: "key", use: "body", where: "Primary key labels" },
  { foreground: "paper", background: "brick", use: "body", where: "Destructive key labels" },
  { foreground: "brick", background: "paper", use: "body", where: "Damage found at handoff, field errors" },
  { foreground: "paper", background: "navy", use: "body", where: "Text on PayPal cards" },
  { foreground: "ink", background: "blue", use: "body", where: "Seller rows once PayPal pays them" },
  { foreground: "stone", background: "paper", use: "graphic", where: "Field borders and SDK slot outlines" },
  { foreground: "flint", background: "table", use: "graphic", where: "The 3D room outline and schedule slot outline" },
  { foreground: "flint", background: "well", use: "graphic", where: "The switch track and knob when off" },
  { foreground: "paper", background: "navy", use: "graphic", where: "The switch knob when on" },
];

/** Tailwind spacing multipliers in use. The base unit is 4 px. */
export const SPACING_SCALE = [1, 2, 3, 4, 6, 8, 12, 16, 24] as const;
export const SPACING_UNIT_PX = 4;

export const RADIUS_SCALE = [
  { token: "sm", px: 6, use: "Tags and the PayPal mark ground" },
  { token: "md", px: 8, use: "The current step, thumbnails" },
  { token: "lg", px: 12, use: "Keys, fields, checklist and seller rows" },
  { token: "xl", px: 16, use: "Choice keys, PayPal cards" },
  { token: "2xl", px: 20, use: "Panels" },
  { token: "3xl", px: 24, use: "The 3D room stage, bottom sheets" },
] as const;

/** Seven sizes. Line heights are in px, and the two display sizes tighten by 0.02 em. */
export const TYPE_SCALE = [
  { token: "xs", px: 12, lineHeight: 16, use: "Meta, sandbox IDs, row labels" },
  { token: "sm", px: 14, lineHeight: 20, use: "Secondary text, checklist rows, steps" },
  { token: "base", px: 16, lineHeight: 24, use: "Body text, activity sentences, keys" },
  { token: "lg", px: 20, lineHeight: 28, use: "Choice key titles, panel titles on phones" },
  { token: "xl", px: 28, lineHeight: 32, use: "Panel titles, section headings" },
  { token: "2xl", px: 40, lineHeight: 44, use: "Totals and prices, page titles on phones" },
  { token: "3xl", px: 64, lineHeight: 64, use: "Page titles on desktop" },
] as const;

/** Hierarchy comes from size and color. Nothing heavier than 600 exists in the theme. */
export const FONT_WEIGHTS = [
  { token: "normal", weight: 400, use: "Body text" },
  { token: "medium", weight: 500, use: "Names, labels, the current step" },
  { token: "semibold", weight: 600, use: "Titles, figures, key labels" },
] as const;

export const MOTION = [
  { token: "press", ms: 80, use: "A key travels down under a press" },
  { token: "quick", ms: 160, use: "Hover, focus, and switch changes" },
  { token: "settle", ms: 320, use: "A seller row fills and the total ticks up" },
] as const;
