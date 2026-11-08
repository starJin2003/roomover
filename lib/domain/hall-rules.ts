import { z } from "zod";
import { LISTING_CATEGORIES } from "./enums";
import { BULB_TYPES } from "./listing";

/**
 * Machine readable hall rules. Each constraint cites the section of the hall
 * rules document it encodes, so an agent can quote the rule it applied. The
 * rules check reads listing categories, placements, dimensions, and specs.
 * The fit check reads the egress clearance.
 */

const ruleBase = {
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  section: z.string().regex(/^\d+(?:\.\d+)*$/),
  summary: z.string().min(1),
};

const positiveMm = z.number().int().positive();

/** Prohibits an item when every given matcher matches it. */
export const prohibitedItemSchema = z.strictObject({
  ...ruleBase,
  kind: z.literal("prohibited_item"),
  match: z
    .strictObject({
      categories: z.array(z.enum(LISTING_CATEGORIES)).min(1).optional(),
      bulbTypes: z.array(z.enum(BULB_TYPES)).min(1).optional(),
      keywords: z.array(z.string().min(1)).min(1).optional(),
    })
    .refine((match) => Object.keys(match).length > 0, "A prohibition needs at least one matcher."),
});

export const categoryLimitSchema = z
  .strictObject({
    ...ruleBase,
    kind: z.literal("category_limit"),
    category: z.enum(LISTING_CATEGORIES),
    maxWidthMm: positiveMm.optional(),
    maxDepthMm: positiveMm.optional(),
    maxHeightMm: positiveMm.optional(),
    maxCapacityLiters: z.number().int().positive().optional(),
    maxWatts: z.number().int().positive().optional(),
    maxPerResident: z.number().int().positive().optional(),
  })
  .refine(
    ({ maxWidthMm, maxDepthMm, maxHeightMm, maxCapacityLiters, maxWatts, maxPerResident }) =>
      [maxWidthMm, maxDepthMm, maxHeightMm, maxCapacityLiters, maxWatts, maxPerResident].some(
        (limit) => limit !== undefined,
      ),
    "A category limit needs at least one limit.",
  );

export const bedLoftingSchema = z.strictObject({
  ...ruleBase,
  kind: z.literal("bed_lofting"),
  residentLoftingAllowed: z.boolean(),
  maxRiserLiftMm: z.number().int().nonnegative(),
});

export const egressClearanceSchema = z.strictObject({
  ...ruleBase,
  kind: z.literal("egress_clearance"),
  minPathWidthMm: positiveMm,
});

/** Items with the `wall` placement need fasteners unless this allows them. */
export const wallMountingSchema = z.strictObject({
  ...ruleBase,
  kind: z.literal("wall_mounting"),
  fastenersAllowed: z.boolean(),
});

export const hallConstraintSchema = z.discriminatedUnion("kind", [
  prohibitedItemSchema,
  categoryLimitSchema,
  bedLoftingSchema,
  egressClearanceSchema,
  wallMountingSchema,
]);

export const hallConstraintsSchema = z
  .array(hallConstraintSchema)
  .min(1)
  .refine(
    (constraints) => new Set(constraints.map((constraint) => constraint.id)).size === constraints.length,
    "Constraint IDs must be unique within a hall.",
  );

export type HallConstraint = z.infer<typeof hallConstraintSchema>;
