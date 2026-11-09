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
  "rolling_cart",
  "generic",
] as const;
export type FurnitureType = (typeof FURNITURE_TYPES)[number];

interface FurnitureSpec {
  /** Null for the generic shape, which stands in for an item of any category that none of its types describes. */
  category: ListingCategory | null;
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
  rolling_cart: { category: "storage", round: false, host: true, wallClearanceMm: 0 },
  generic: { category: null, round: false, host: false, wallClearanceMm: 0 },
};

/** Gap between identical pieces sold as one listing, such as three bookcases side by side. */
export const PIECE_GAP_MM = 20;

interface TypeRule {
  type: FurnitureType;
  keywords?: readonly string[];
  placement?: Placement;
}

/**
 * Rules run in order inside a category, and a listing whose title names none
 * of them gets the generic shape, so a cabinet never draws or reads as a
 * drawer unit. Title words decide most cases, because a seller names a clamp
 * lamp or a bean bag in the title long before any dimension tells them apart.
 */
const TYPE_RULES: Readonly<Record<ListingCategory, readonly TypeRule[]>> = {
  bed_accessory: [
    { type: "pillows", keywords: ["pillow"] },
    { type: "throw", keywords: ["throw", "blanket"] },
    { type: "comforter", keywords: ["comforter", "duvet", "quilt", "bedspread", "topper"] },
  ],
  desk: [{ type: "desk", keywords: ["desk", "table", "workstation"] }],
  chair: [
    { type: "bean_bag", keywords: ["bean bag", "beanbag"] },
    { type: "pouf", keywords: ["pouf", "ottoman"] },
    { type: "armchair", keywords: ["armchair", "lounge", "wingback", "accent chair"] },
    { type: "desk_chair", keywords: ["desk chair", "task chair", "office chair", "rolling"] },
    { type: "side_chair", keywords: ["chair"] },
  ],
  shelf: [{ type: "bookcase", keywords: ["bookcase", "bookshel", "shel"] }],
  lamp: [
    { type: "clamp_lamp", keywords: ["clamp"] },
    { type: "floor_lamp", keywords: ["lamp", "light"], placement: "floor" },
    { type: "desk_lamp", keywords: ["desk lamp", "balance arm", "task lamp", "architect"] },
    { type: "table_lamp", keywords: ["lamp"] },
  ],
  rug: [
    { type: "round_rug", keywords: ["round"] },
    { type: "rug", keywords: ["rug", "carpet", "runner", "mat"] },
  ],
  mini_fridge: [{ type: "mini_fridge", keywords: ["fridge", "refrigerator", "freezer"] }],
  storage: [
    { type: "tote", keywords: ["tote", "bin"] },
    { type: "basket", keywords: ["basket", "hamper"] },
    { type: "rolling_cart", keywords: ["cart", "trolley"] },
    { type: "drawer_unit", keywords: ["drawer", "tower", "organizer", "dresser", "chest"] },
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
  const match = TYPE_RULES[listing.category].find(
    (rule) =>
      (rule.keywords === undefined || rule.keywords.some((keyword) => mentions(title, keyword))) &&
      (rule.placement === undefined || rule.placement === listing.placement),
  );
  return match?.type ?? "generic";
}

/**
 * A listing's own name as a noun for sentences, such as "wooden step stool"
 * from "Wooden step stool, folds flat". Words after a comma or "with" are
 * details, and a leading capital goes unless the word is an acronym.
 */
export function nounFromTitle(title: string): string {
  const head = title.split(/,| with /i)[0].trim().replace(/\s+/g, " ");
  const words = head.split(" ").slice(0, 6).join(" ");
  const lowered = /^[A-Z][a-z]/.test(words) ? words[0].toLowerCase() + words.slice(1) : words;
  return lowered.slice(0, 60).trim() || "item";
}

/** The noun a layout item carries. Only the generic shape needs one, since every other type has its own word. */
export function nounFor(type: FurnitureType, title: string): { noun?: string } {
  return type === "generic" ? { noun: nounFromTitle(title) } : {};
}
