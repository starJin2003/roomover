import { z } from "zod";

export const CONDITION_GRADES = ["like_new", "good", "fair", "worn"] as const;
export type ConditionGrade = (typeof CONDITION_GRADES)[number];

export const DEFECT_SEVERITIES = ["minor", "moderate", "major"] as const;
export type DefectSeverity = (typeof DEFECT_SEVERITIES)[number];

export const BULB_TYPES = ["led", "cfl", "incandescent", "halogen"] as const;
export type BulbType = (typeof BULB_TYPES)[number];

const cents = z.number().int().nonnegative();

export const defectSchema = z.strictObject({
  location: z.string().min(1),
  description: z.string().min(1),
  severity: z.enum(DEFECT_SEVERITIES),
});

export const conditionReportSchema = z.strictObject({
  grade: z.enum(CONDITION_GRADES),
  notes: z.string().min(1),
  defects: z.array(defectSchema),
  assessedBy: z.enum(["seller", "seller_agent"]),
});

/**
 * The new product an item is compared against for pricing and savings.
 * `seed_estimate` marks demo prices for a generic product class, `channel3`
 * marks a matched catalog product, and `seller_agent` marks the seller
 * agent's estimate when Channel3 found no product that matches the photo.
 */
export const retailReferenceSchema = z.strictObject({
  productName: z.string().min(1),
  newPriceCents: cents.positive(),
  source: z.enum(["seed_estimate", "channel3", "seller", "seller_agent"]),
  sourceNote: z.string().min(1),
  url: z.url({ protocol: /^https$/ }).optional(),
  channel3ProductId: z.string().min(1).optional(),
  checkedOn: z.iso.date(),
});

/** `src` is a path under the public folder for seed photos and an HTTPS URL for uploads. */
export const listingPhotoSchema = z.strictObject({
  src: z.union([z.string().regex(/^\/[A-Za-z0-9/_.-]+$/), z.url({ protocol: /^https$/ })]),
  alt: z.string().min(1),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
});

export const listingPhotosSchema = z.array(listingPhotoSchema).min(1);

/**
 * The item's colors read from its photo, main color first. Multi part items
 * list the accent next (a lamp's brass joints), and sets of pieces list one
 * color per piece.
 */
export const listingColorSchema = z.strictObject({
  name: z.string().min(1),
  hex: z.string().regex(/^#[0-9A-F]{6}$/, "Expected an uppercase #RRGGBB color"),
});

export const listingColorsSchema = z.array(listingColorSchema).min(1).max(4);

/** Attributes the hall rules check reads. Each field applies only to some categories. */
export const listingSpecsSchema = z.strictObject({
  bulbType: z.enum(BULB_TYPES).optional(),
  watts: z.number().int().positive().optional(),
  capacityLiters: z.number().int().positive().optional(),
  hasFreezer: z.boolean().optional(),
  liftHeightMm: z.number().int().positive().optional(),
  /** Identical pieces sold as a set. The listing dimensions describe one piece. */
  pieces: z.number().int().min(2).optional(),
});

export type Defect = z.infer<typeof defectSchema>;
export type ConditionReport = z.infer<typeof conditionReportSchema>;
export type RetailReference = z.infer<typeof retailReferenceSchema>;
export type ListingPhoto = z.infer<typeof listingPhotoSchema>;
export type ListingSpecs = z.infer<typeof listingSpecsSchema>;
export type ListingColor = z.infer<typeof listingColorSchema>;
