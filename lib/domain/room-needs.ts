import type { ListingCategory } from "./enums";

/**
 * What a lived-in room asks for beyond the furniture the university
 * provides. The buyer agent reads which needs are still open after every
 * change, so it covers them within the budget without a fixed item count.
 */
export const ROOM_NEEDS = ["seating", "lighting", "storage", "floor", "comfort"] as const;
export type RoomNeed = (typeof ROOM_NEEDS)[number];

const NEED_BY_CATEGORY: Readonly<Partial<Record<ListingCategory, RoomNeed>>> = {
  chair: "seating",
  lamp: "lighting",
  storage: "storage",
  shelf: "storage",
  rug: "floor",
  bed_accessory: "comfort",
};

export const needFor = (category: ListingCategory): RoomNeed | undefined => NEED_BY_CATEGORY[category];

/** The listing categories that cover a need. */
export const categoriesFor = (need: RoomNeed): ListingCategory[] => (Object.entries(NEED_BY_CATEGORY) as [ListingCategory, RoomNeed][]).flatMap(([category, covers]) => (covers === need ? [category] : []));

export interface NeedCoverage {
  covered: RoomNeed[];
  open: RoomNeed[];
}

export function needCoverage(categories: readonly ListingCategory[]): NeedCoverage {
  const met = new Set(categories.flatMap((category) => needFor(category) ?? []));
  return {
    covered: ROOM_NEEDS.filter((need) => met.has(need)),
    open: ROOM_NEEDS.filter((need) => !met.has(need)),
  };
}
