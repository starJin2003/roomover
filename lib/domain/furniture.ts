import type { ListingCategory, Placement } from "./enums";

/**
 * The procedural furniture types the 3D room draws. Each listing category maps
 * to one or more types, and the fit check reads the footprint shape and wall
 * clearance from here.
 */
export const FURNITURE_TYPES = [
  "comforter",
  "pillows",
  "throw",
  "desk",
  "desk_chair",
  "side_chair",
  "armchair",
  "bean_bag",
  "pouf",
  "bookcase",
  "desk_lamp",
  "table_lamp",
  "clamp_lamp",
  "floor_lamp",
  "rug",
  "round_rug",
  "mini_fridge",
  "drawer_unit",
  "basket",
  "tote",
] as const;
export type FurnitureType = (typeof FURNITURE_TYPES)[number];

interface FurnitureSpec {
  category: ListingCategory;
  /** A single round piece covers a circle on the floor. Sets of pieces stand in a row. */
  round: boolean;
  /** Other items may stand on its top. */
  host: boolean;
  /** Gap the item keeps from every wall. Compact fridges vent heat through the back and sides. */
  wallClearanceMm: number;
}

export const FURNITURE: Readonly<Record<FurnitureType, FurnitureSpec>> = {
  comforter: { category: "bed_accessory", round: false, host: false, wallClearanceMm: 0 },
  pillows: { category: "bed_accessory", round: false, host: false, wallClearanceMm: 0 },
  throw: { category: "bed_accessory", round: false, host: false, wallClearanceMm: 0 },
  desk: { category: "desk", round: false, host: true, wallClearanceMm: 0 },
  desk_chair: { category: "chair", round: false, host: false, wallClearanceMm: 0 },
  side_chair: { category: "chair", round: false, host: false, wallClearanceMm: 0 },
  armchair: { category: "chair", round: false, host: false, wallClearanceMm: 0 },
  bean_bag: { category: "chair", round: true, host: false, wallClearanceMm: 0 },
  pouf: { category: "chair", round: true, host: false, wallClearanceMm: 0 },
  bookcase: { category: "shelf", round: false, host: true, wallClearanceMm: 0 },
  desk_lamp: { category: "lamp", round: false, host: false, wallClearanceMm: 0 },
  table_lamp: { category: "lamp", round: true, host: false, wallClearanceMm: 0 },
  clamp_lamp: { category: "lamp", round: false, host: false, wallClearanceMm: 0 },
  floor_lamp: { category: "lamp", round: true, host: false, wallClearanceMm: 0 },
  rug: { category: "rug", round: false, host: false, wallClearanceMm: 0 },
  round_rug: { category: "rug", round: true, host: false, wallClearanceMm: 0 },
  mini_fridge: { category: "mini_fridge", round: false, host: true, wallClearanceMm: 50 },
  drawer_unit: { category: "storage", round: false, host: true, wallClearanceMm: 0 },
  basket: { category: "storage", round: true, host: false, wallClearanceMm: 0 },
  tote: { category: "storage", round: false, host: false, wallClearanceMm: 0 },
};

/** Gap between identical pieces sold as one listing, such as three bookcases side by side. */
export const PIECE_GAP_MM = 20;

interface TypeRule {
  type: FurnitureType;
  keywords?: readonly string[];
  placement?: Placement;
}

/**
 * Rules run in order inside a category, and the last rule of each list is the
 * fallback. Title words decide most cases, because a seller names a clamp lamp
 * or a bean bag in the title long before any dimension tells them apart.
 */
const TYPE_RULES: Readonly<Record<ListingCategory, readonly TypeRule[]>> = {
  bed_accessory: [
    { type: "pillows", keywords: ["pillow"] },
    { type: "throw", keywords: ["throw", "blanket"] },
    { type: "comforter" },
  ],
  desk: [{ type: "desk" }],
  chair: [
    { type: "bean_bag", keywords: ["bean bag", "beanbag"] },
    { type: "pouf", keywords: ["pouf", "ottoman"] },
    { type: "armchair", keywords: ["armchair", "lounge", "wingback", "accent chair"] },
    { type: "desk_chair", keywords: ["desk chair", "task chair", "office chair", "rolling"] },
    { type: "side_chair" },
  ],
  shelf: [{ type: "bookcase" }],
  lamp: [
    { type: "clamp_lamp", keywords: ["clamp"] },
    { type: "floor_lamp", placement: "floor" },
    { type: "desk_lamp", keywords: ["desk lamp", "balance arm", "task lamp", "architect"] },
    { type: "table_lamp" },
  ],
  rug: [{ type: "round_rug", keywords: ["round"] }, { type: "rug" }],
  mini_fridge: [{ type: "mini_fridge" }],
  storage: [
    { type: "tote", keywords: ["tote", "bin"] },
    { type: "basket", keywords: ["basket"] },
    { type: "drawer_unit" },
  ],
};

export interface TypedListing {
  category: ListingCategory;
  placement: Placement;
  title: string;
}

/** Keywords match at the start of a word, so "pillow" finds "pillows" and "bin" skips "cabinet". */
function mentions(title: string, keyword: string): boolean {
  return new RegExp(`(^|[^a-z])${keyword}`).test(title);
}

export function furnitureTypeFor(listing: TypedListing): FurnitureType {
  const title = listing.title.toLowerCase();
  const rules = TYPE_RULES[listing.category];
  const match = rules.find(
    (rule) =>
      (rule.keywords === undefined || rule.keywords.some((keyword) => mentions(title, keyword))) &&
      (rule.placement === undefined || rule.placement === listing.placement),
  );
  return (match ?? rules[rules.length - 1]).type;
}
