import type { ContrastUse } from "./contrast";

/**
 * Roomover's design tokens. `app/globals.css` declares the same values as CSS
 * variables and Tailwind theme values, and a unit test keeps the two in step.
 * The first six colors come from the 2024 PayPal monogram. Flint exists
 * because Stone fails AA for body text on Paper, and Brick marks errors and
 * destructive actions.
 */
export const PALETTE = [
  { token: "paper", name: "Paper", hex: "#F6F3EE", role: "Page and panel background" },
  { token: "ink", name: "Ink", hex: "#14151A", role: "Text, primary actions, focus rings" },
  { token: "stone", name: "Stone", hex: "#8C877D", role: "Lines, control borders, text at 24 px and up" },
  { token: "flint", name: "Flint", hex: "#67625A", role: "Secondary text at any size" },
  { token: "navy", name: "PayPal navy", hex: "#002991", role: "Payment headings" },
  { token: "blue", name: "PayPal blue", hex: "#008CFF", role: "Only where money moves, as a fill or a rule, never as text" },
  { token: "sky", name: "Sky", hex: "#60CDFF", role: "The single accent in the 3D room" },
  { token: "brick", name: "Brick", hex: "#A3341E", role: "Errors, disputes, destructive actions" },
] as const;

export type ColorToken = (typeof PALETTE)[number]["token"];

export const COLOR: Readonly<Record<ColorToken, string>> = Object.fromEntries(
  PALETTE.map((color) => [color.token, color.hex]),
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
  { foreground: "ink", background: "paper", use: "body", where: "Body text and headings" },
  { foreground: "flint", background: "paper", use: "body", where: "Help text, timestamps, secondary labels" },
  { foreground: "navy", background: "paper", use: "body", where: "Payment headings, PayPal API names" },
  { foreground: "brick", background: "paper", use: "body", where: "Error messages" },
  { foreground: "paper", background: "ink", use: "body", where: "Primary button label, Ink swatch" },
  { foreground: "paper", background: "brick", use: "body", where: "Destructive button, alert chips" },
  { foreground: "paper", background: "navy", use: "body", where: "PayPal navy swatch" },
  { foreground: "paper", background: "flint", use: "body", where: "Flint swatch" },
  { foreground: "ink", background: "blue", use: "body", where: "Money chips and PayPal sandbox IDs" },
  { foreground: "ink", background: "stone", use: "body", where: "Stone swatch" },
  { foreground: "ink", background: "sky", use: "body", where: "Sky swatch and 3D item labels" },
  { foreground: "stone", background: "paper", use: "large", where: "Display numerals at 24 px and up" },
  { foreground: "stone", background: "paper", use: "graphic", where: "Input borders, dividers, neutral chip outlines" },
  { foreground: "blue", background: "paper", use: "graphic", where: "PayPal rule in the activity panel, money held outlines" },
];

/** Tailwind spacing multipliers in use. The base unit is 4 px. */
export const SPACING_SCALE = [1, 2, 3, 4, 6, 8, 12, 16, 24] as const;
export const SPACING_UNIT_PX = 4;

export const RADIUS_SCALE = [
  { token: "sm", px: 6, use: "Chips inside dense rows, ID tags" },
  { token: "md", px: 10, use: "Buttons, inputs, photos" },
  { token: "lg", px: 16, use: "Listing cards, swatches" },
  { token: "xl", px: 24, use: "Panels" },
  { token: "full", px: 9999, use: "Status chips" },
] as const;

/** Sizes follow the classic typographic scale. Line heights are in px. */
export const TYPE_SCALE = [
  { token: "xs", px: 12, lineHeight: 16, use: "Timestamps, chip labels" },
  { token: "sm", px: 14, lineHeight: 20, use: "Help text, table cells, activity lines" },
  { token: "base", px: 16, lineHeight: 24, use: "Body text, inputs, buttons" },
  { token: "md", px: 18, lineHeight: 28, use: "Lead text, card titles" },
  { token: "lg", px: 21, lineHeight: 30, use: "Panel titles" },
  { token: "xl", px: 24, lineHeight: 32, use: "Prices, section leads" },
  { token: "2xl", px: 36, lineHeight: 40, use: "Section headings" },
  { token: "3xl", px: 48, lineHeight: 52, use: "Page titles on phones" },
  { token: "4xl", px: 72, lineHeight: 72, use: "Page titles on desktop" },
] as const;

export const MOTION = [
  { token: "press", ms: 80, use: "A key travels down under a press" },
  { token: "quick", ms: 160, use: "Hover and focus changes" },
  { token: "settle", ms: 320, use: "Money moves and a balance changes" },
  { token: "land", ms: 560, use: "An item drops into the room" },
] as const;
