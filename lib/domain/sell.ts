import { z } from "zod";
import { campusCalendar, campusDay, campusWindow, type Window } from "@/scripts/seed/campus";
import { HANDOFF_MODES, LISTING_CATEGORIES, PLACEMENTS, type HandoffMode, type ListingCategory, type Placement } from "./enums";
import { handoffWindow, type MoveWindows } from "./handoff";
import { CONDITION_GRADES, DEFECT_SEVERITIES, listingColorSchema } from "./listing";
import { clampPrices, MAX_NEW_PRICE_CENTS, MIN_PRICE_CENTS } from "./pricing";

/** Millimeters, width by depth by height, with sizes a dorm item can have. */
const sizeMmSchema = z.strictObject({
  widthMm: z.number().int().min(20).max(4000),
  depthMm: z.number().int().min(5).max(4000),
  heightMm: z.number().int().min(5).max(3000),
});

export type SizeMmFields = z.infer<typeof sizeMmSchema>;

/** One product Channel3 returned for the photo, trimmed to what Sell shows and prices from. */
export const channel3CandidateSchema = z.strictObject({
  productId: z.string().min(1),
  title: z.string().min(1),
  brand: z.string().min(1).nullable(),
  imageUrl: z.url({ protocol: /^https$/ }).nullable(),
  newPriceCents: z.number().int().positive(),
  url: z.url({ protocol: /^https?$/ }),
  domain: z.string().min(1),
  /** Null unless the offer states all three measurements. */
  sizeMm: sizeMmSchema.nullable(),
});

export type Channel3Candidate = z.infer<typeof channel3CandidateSchema>;

/** The Channel3 call behind a draft, for Under the hood and the cost record. */
export const channel3LookupSchema = z.strictObject({
  candidates: z.array(channel3CandidateSchema).max(4),
  /** 1 for a live call, 0 when the cache or a test fixture answered. */
  credits: z.number().int().min(0),
  cached: z.boolean(),
  latencyMs: z.number().int().min(0),
  /** Why Channel3 gave no answer, such as an outage or the demo's daily cap. The seller then enters the size. */
  unavailable: z.string().min(1).nullable(),
});

export type Channel3Lookup = z.infer<typeof channel3LookupSchema>;

/** Everything Roomover lists, plus `other` for a photo of something it does not. */
export const SELLER_CATEGORIES = [...LISTING_CATEGORIES, "other"] as const;

/**
 * What the seller agent reports through describe_listing. Prices are whole
 * dollars, which the model reads and writes more reliably than cents, and
 * code converts and clamps them.
 */
export const sellerVerdictSchema = z.strictObject({
  category: z.enum(SELLER_CATEGORIES).describe("The kind of item. Use other when it is none of the listed kinds."),
  title: z.string().min(3).max(60).describe("A short plain title with the color first, such as Black balance arm desk lamp. No brand names."),
  description: z.string().min(10).max(300).describe("One or two sentences a student moving in reads, naming any visible wear."),
  condition: z.enum(CONDITION_GRADES),
  defects: z
    .array(
      z.strictObject({
        location: z.string().min(1).max(40),
        description: z.string().min(1).max(120),
        severity: z.enum(DEFECT_SEVERITIES),
      }),
    )
    .max(5)
    .describe("Only wear you can point to in the photo. Empty when there is none."),
  colorName: z.string().min(1).max(24).describe("The main color in one or two plain words."),
  colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).describe("The main color as #RRGGBB, read from the item itself."),
  material: z.string().min(1).max(40),
  styleTags: z.array(z.string().min(1).max(20)).max(3).describe("Up to three lowercase style words, such as minimal or cozy."),
  matchedCandidate: z.number().int().min(1).max(4).nullable().describe("The number of the Channel3 candidate that is the same product, or null when none is."),
  newPriceDollars: z.number().int().min(1).max(5000).describe("The matched candidate's price, or your estimate of a comparable new item at a mass market US retailer."),
  priceDollars: z.number().int().min(1).max(5000),
  floorDollars: z.number().int().min(1).max(5000).describe("The lowest price the seller should accept."),
});

export type SellerVerdict = z.infer<typeof sellerVerdictSchema>;

export const defectDraftSchema = z.strictObject({
  location: z.string().min(1),
  description: z.string().min(1),
  severity: z.enum(DEFECT_SEVERITIES),
});

/** The filled in listing a draft holds once the seller agent answered, with prices already clamped. */
export const draftDetailsSchema = z.strictObject({
  category: z.enum(LISTING_CATEGORIES),
  placement: z.enum(PLACEMENTS),
  title: z.string().min(1),
  description: z.string().min(1),
  conditionGrade: z.enum(CONDITION_GRADES),
  defects: z.array(defectDraftSchema),
  color: listingColorSchema,
  material: z.string().min(1),
  styleTags: z.array(z.string().min(1)),
  match: channel3CandidateSchema.nullable(),
  newPriceCents: z.number().int().positive(),
  newPriceSource: z.enum(["channel3", "seller_agent"]),
  priceCents: z.number().int().positive(),
  floorPriceCents: z.number().int().positive(),
  sizeMm: sizeMmSchema.nullable(),
  model: z.string().min(1),
  attempts: z.union([z.literal(1), z.literal(2)]),
});

export type DraftDetails = z.infer<typeof draftDetailsSchema>;

/** When the seller leaves. This term hands over at winter move in, and spring waits in storage for fall move in. */
export const MOVE_OUT_TERMS = ["this_term", "spring"] as const;
export type MoveOutTerm = (typeof MOVE_OUT_TERMS)[number];

/** What the seller confirms when listing. Everything else comes from the draft. */
export const listInputSchema = z.strictObject({
  priceCents: z.number().int().positive(),
  floorPriceCents: z.number().int().positive(),
  sizeMm: sizeMmSchema.nullable(),
  moveOut: z.enum(MOVE_OUT_TERMS),
  handoffMode: z.enum(HANDOFF_MODES),
});

export type ListInput = z.infer<typeof listInputSchema>;

/** Where the item sits in a room, which the fit check needs. Title words separate a floor lamp from a desk lamp. */
export function placementFor(category: ListingCategory, title: string): Placement {
  const words = title.toLowerCase();
  switch (category) {
    case "rug":
      return "underlay";
    case "bed_accessory":
      return "bed";
    case "lamp":
      return /(^|[^a-z])floor/.test(words) ? "floor" : "surface";
    case "storage":
      return /under[ -]?bed/.test(words) ? "bed" : "floor";
    default:
      return "floor";
  }
}

/**
 * Move out and move in windows for a listing, counted from the campus day it
 * is listed on, like the seed calendar. A direct handoff overlaps winter move
 * in, and storage or same room handoffs leave before the next student
 * arrives. Null when the mode cannot serve the term, such as a direct
 * handoff after spring finals, months before anyone moves in.
 */
export function sellWindows(term: MoveOutTerm, mode: HandoffMode, now: Date): MoveWindows | null {
  const day = campusDay(now);
  const calendar = campusCalendar(day);
  const pair = (moveOut: Window, moveIn: Window): MoveWindows => ({
    moveOutStartsAt: moveOut.startsAt,
    moveOutEndsAt: moveOut.endsAt,
    moveInStartsAt: moveIn.startsAt,
    moveInEndsAt: moveIn.endsAt,
  });
  const windows =
    term === "this_term"
      ? mode === "direct"
        ? pair(campusWindow(day, [7, "09:00"], [17, "20:00"]), calendar.winterMoveIn)
        : pair(calendar.fallMoveOut, calendar.winterMoveIn)
      : pair(calendar.springMoveOut, calendar.fallMoveIn);
  return handoffWindow(mode, windows) === null ? null : windows;
}

/** Converts one Channel3 length to millimeters. */
export function toMillimeters(length: { number: number; unit: "mm" | "cm" | "m" | "in" | "ft" }): number {
  const perUnit = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[length.unit];
  return Math.round(length.number * perUnit);
}

/**
 * Width, depth, and height from a retail listing's length, width, and
 * height. Retailers name the two floor measurements inconsistently, so the
 * longer one is the width. Null unless all three are stated and plausible.
 */
export function sizeFromRetail(dimensions: { lengthMm: number | null; widthMm: number | null; heightMm: number | null }): SizeMmFields | null {
  const { lengthMm, widthMm, heightMm } = dimensions;
  if (lengthMm === null || widthMm === null || heightMm === null) return null;
  const parsed = sizeMmSchema.safeParse({ widthMm: Math.max(lengthMm, widthMm), depthMm: Math.min(lengthMm, widthMm), heightMm });
  return parsed.success ? parsed.data : null;
}

const CATEGORY_WORDS: Readonly<Record<ListingCategory, string>> = {
  desk: "desks",
  chair: "chairs",
  shelf: "shelves",
  lamp: "lamps",
  rug: "rugs",
  mini_fridge: "mini fridges",
  storage: "storage",
  bed_accessory: "bedding",
};

/** The sentence a seller reads when the photo shows something Roomover does not list. */
export function notListedSentence(title: string): string {
  const kinds = Object.values(CATEGORY_WORDS);
  return `Roomover lists ${kinds.slice(0, -1).join(", ")}, and ${kinds.at(-1)}. This photo looks like ${title.toLowerCase()}, so try a photo of one of those.`;
}

/**
 * The draft's details from the seller agent's verdict. Code picks the
 * matched candidate by its number, takes the new price and the size from it,
 * and clamps the proposed price and floor, so the model's numbers never
 * reach the listing unchecked.
 */
export function draftDetailsFrom(verdict: SellerVerdict, candidates: readonly Channel3Candidate[], meta: { model: string; attempts: 1 | 2 }): { ok: true; details: DraftDetails } | { ok: false; reason: string } {
  if (verdict.category === "other") return { ok: false, reason: notListedSentence(verdict.title) };
  const match = verdict.matchedCandidate === null ? null : (candidates[verdict.matchedCandidate - 1] ?? null);
  const newPriceCents = match?.newPriceCents ?? Math.min(Math.max(verdict.newPriceDollars * 100, MIN_PRICE_CENTS), MAX_NEW_PRICE_CENTS);
  const prices = clampPrices({ priceCents: verdict.priceDollars * 100, floorPriceCents: verdict.floorDollars * 100 }, newPriceCents);
  const title = verdict.title.trim();
  return {
    ok: true,
    details: {
      category: verdict.category,
      placement: placementFor(verdict.category, title),
      title,
      description: verdict.description.trim(),
      conditionGrade: verdict.condition,
      defects: verdict.defects,
      color: { name: verdict.colorName.trim().toLowerCase(), hex: verdict.colorHex.toUpperCase() },
      material: verdict.material.trim().toLowerCase(),
      styleTags: [...new Set(verdict.styleTags.map((tag) => tag.trim().toLowerCase()))],
      match,
      newPriceCents,
      newPriceSource: match === null ? "seller_agent" : "channel3",
      priceCents: prices.priceCents,
      floorPriceCents: prices.floorPriceCents,
      sizeMm: match?.sizeMm ?? null,
      model: meta.model,
      attempts: meta.attempts,
    },
  };
}
