import { z } from "zod";
import { LISTING_CATEGORIES } from "./enums";
import { quarterTurnSchema } from "./room";

/**
 * The furnished room the buyer agent builds and the 3D scene renders. Item
 * positions use the room coordinates in `room.ts`, with x and y at the center
 * of the footprint and `elevationMm` above the floor for items that stand on
 * furniture.
 */

const layoutItemBase = {
  key: z.string().min(1),
  category: z.enum(LISTING_CATEGORIES),
  widthMm: z.number().int().positive(),
  depthMm: z.number().int().positive(),
  heightMm: z.number().int().positive(),
  xMm: z.number().int().nonnegative(),
  yMm: z.number().int().nonnegative(),
  elevationMm: z.number().int().nonnegative(),
  rotationDeg: quarterTurnSchema,
};

export const layoutItemSchema = z.discriminatedUnion("source", [
  z.strictObject({
    ...layoutItemBase,
    source: z.literal("listing"),
    listingId: z.uuid(),
  }),
  z.strictObject({
    ...layoutItemBase,
    source: z.literal("new_product"),
    channel3ProductId: z.string().min(1),
    productName: z.string().min(1),
    priceCents: z.number().int().positive(),
  }),
]);

export const planLayoutSchema = z
  .strictObject({ items: z.array(layoutItemSchema) })
  .refine(
    (layout) => new Set(layout.items.map((item) => item.key)).size === layout.items.length,
    "Layout item keys must be unique.",
  );

export const EMPTY_LAYOUT: PlanLayout = { items: [] };

export type LayoutItem = z.infer<typeof layoutItemSchema>;
export type PlanLayout = z.infer<typeof planLayoutSchema>;
