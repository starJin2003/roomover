import { furnitureTypeFor } from "@/lib/domain/furniture";
import { planLayoutSchema, type LayoutItem, type PlanLayout } from "@/lib/domain/layout";
import { PRESET_SLUGS } from "./campus";
import { seedId } from "./ids";
import { seedListings } from "./listings";

/**
 * Hand placed layouts in the shape the buyer agent's `place_item` tool writes.
 * The demo layout is Jordan Ellis's five seller winter cart in Harbor Hall
 * 214. The test layouts spread all 24 listings over the three presets, and a
 * unit test runs the fit check over each one.
 */

// Listing titles, sizes, and placements stay the same on every seed day.
const CATALOG_DAY = "2026-11-08";
const listingsById = new Map(seedListings(CATALOG_DAY).map((listing) => [listing.id, listing]));

interface Spot {
  x: number;
  y: number;
  rotation?: number;
  elevation?: number;
}

function place(slug: string, spot: Spot): LayoutItem {
  const listing = listingsById.get(seedId("listing", slug));
  if (listing === undefined) throw new Error(`No seed listing ${slug}.`);
  return {
    key: slug,
    source: "listing",
    listingId: listing.id,
    furnitureType: furnitureTypeFor(listing),
    placement: listing.placement ?? "floor",
    widthMm: listing.widthMm,
    depthMm: listing.depthMm,
    heightMm: listing.heightMm,
    pieces: listing.specs?.pieces ?? 1,
    xMm: spot.x,
    yMm: spot.y,
    elevationMm: spot.elevation ?? 0,
    rotationDeg: spot.rotation ?? 0,
  };
}

const layout = (items: LayoutItem[]): PlanLayout => planLayoutSchema.parse({ items });

const HARBOR_DESK_TOP_MM = 750;
const TWIN_BED_TOP_MM = 762;
const PROVIDED_DESK_TOP_MM = 762;

/**
 * Placement order for the demo. Jun's desk goes under the middle window in
 * front of the radiator, Marcus's chair faces it, Ava's lamp stands on it,
 * Sofia's clamp lamp grips the edge of the west desk, and Lea's bean bag lands
 * last between the beds, where the wardrobe by the door does not hide it.
 */
const HARBOR_214_CART: LayoutItem[] = [
  place("jun-white-desk", { x: 1800, y: 600 }),
  place("marcus-mesh-desk-chair", { x: 1800, y: 1180, rotation: 180 }),
  place("ava-desk-lamp", { x: 2150, y: 480, elevation: HARBOR_DESK_TOP_MM }),
  place("sofia-clamp-lamp", { x: 950, y: 140, elevation: PROVIDED_DESK_TOP_MM }),
  place("lea-navy-bean-bag", { x: 1750, y: 2150 }),
];

export const DEMO_PRESET_SLUG = PRESET_SLUGS.harborDouble;
export const HARBOR_214_DEMO_LAYOUT: PlanLayout = layout(HARBOR_214_CART);

export const TEST_LAYOUTS: Readonly<Record<(typeof PRESET_SLUGS)[keyof typeof PRESET_SLUGS], PlanLayout>> = {
  [PRESET_SLUGS.harborDouble]: layout([
    place("ava-floral-area-rug", { x: 1800, y: 2700 }),
    ...HARBOR_214_CART,
    place("jun-compact-fridge", { x: 286, y: 1540, rotation: 270 }),
    place("sofia-reversible-comforter", { x: 3143, y: 2874, rotation: 180, elevation: TWIN_BED_TOP_MM }),
    place("sofia-bed-pillows", { x: 3143, y: 3650, rotation: 180, elevation: TWIN_BED_TOP_MM }),
    place("lea-moving-tote", { x: 3143, y: 2400 }),
  ]),
  [PRESET_SLUGS.birchwoodSingle]: layout([
    place("lea-kilim-rug", { x: 1500, y: 2200 }),
    place("lea-crochet-throw", { x: 457, y: 1500, elevation: TWIN_BED_TOP_MM }),
    place("lea-brass-table-lamp", { x: 2600, y: 1150, elevation: PROVIDED_DESK_TOP_MM }),
    place("sofia-blue-drawer-unit", { x: 2600, y: 1850, rotation: 90, elevation: PROVIDED_DESK_TOP_MM }),
    place("lea-felt-poufs", { x: 1770, y: 2450 }),
  ]),
  [PRESET_SLUGS.breakwaterBedroom]: layout([
    place("jun-round-jute-rug", { x: 1300, y: 3800 }),
    place("marcus-oak-writing-table", { x: 2363, y: 910, rotation: 90 }),
    place("jun-velvet-side-chair", { x: 1700, y: 910, rotation: 270 }),
    place("ava-narrow-bookcases", { x: 2603, y: 2270, rotation: 90 }),
    place("marcus-bell-floor-lamp", { x: 2150, y: 3350 }),
    place("marcus-mustard-armchair", { x: 1300, y: 3700, rotation: 180 }),
    place("marcus-green-floor-lamp", { x: 700, y: 3800 }),
    place("ava-drawer-tower", { x: 180, y: 3400, rotation: 270 }),
    place("sofia-woven-baskets", { x: 1330, y: 4340 }),
  ]),
};
