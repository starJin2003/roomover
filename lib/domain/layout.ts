import { z } from "zod";
import { PLACEMENTS } from "./enums";
import { FURNITURE, FURNITURE_TYPES, PIECE_GAP_MM } from "./furniture";
import { circle, rectangle, type Polygon } from "./geometry";

/**
 * The furnished room the buyer agent's `place_item` tool writes and the 3D
 * scene renders. Positions use the room coordinates in `room.ts`, with x and
 * y at the center of the footprint, `elevationMm` above the floor for items
 * that stand on furniture, and rotation clockwise as seen from above. At 0
 * degrees an item's front faces south, so 90 faces west.
 *
 * Dimensions describe one piece. A listing sold as a set of identical pieces
 * stands in a row along the item's width, `PIECE_GAP_MM` apart.
 */

const lengthMm = z.number().int().positive();
const offsetMm = z.number().int().nonnegative();

const layoutItemBase = {
  key: z.string().min(1),
  furnitureType: z.enum(FURNITURE_TYPES),
  placement: z.enum(PLACEMENTS),
  widthMm: lengthMm,
  depthMm: lengthMm,
  heightMm: lengthMm,
  pieces: z.number().int().min(1).max(6),
  xMm: offsetMm,
  yMm: offsetMm,
  elevationMm: offsetMm,
  rotationDeg: z.number().int().min(0).max(359),
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
  )
  .refine((layout) => {
    const listingIds = layout.items.flatMap((item) => (item.source === "listing" ? [item.listingId] : []));
    return new Set(listingIds).size === listingIds.length;
  }, "A listing appears in a layout once.");

export const EMPTY_LAYOUT: PlanLayout = { items: [] };

export type LayoutItem = z.infer<typeof layoutItemSchema>;
export type PlanLayout = z.infer<typeof planLayoutSchema>;

/** Width of the whole set along the item's own width axis. */
export function rowWidthMm(item: Pick<LayoutItem, "widthMm" | "pieces">): number {
  return item.widthMm * item.pieces + PIECE_GAP_MM * (item.pieces - 1);
}

/** The floor area the item covers, as a convex polygon in room coordinates. */
export function footprint(item: LayoutItem): Polygon {
  if (FURNITURE[item.furnitureType].round && item.pieces === 1) {
    return circle(item.xMm, item.yMm, Math.max(item.widthMm, item.depthMm) / 2);
  }
  return rectangle(item.xMm, item.yMm, rowWidthMm(item), item.depthMm, item.rotationDeg);
}

/** Height of the item's top above the floor. */
export function topMm(item: LayoutItem): number {
  return item.elevationMm + item.heightMm;
}
