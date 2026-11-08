import type { HallConstraint } from "@/lib/domain/hall-rules";
import { UNIVERSITY } from "./campus";

/**
 * Room standards for each Lakeshore hall, as a document for people and agents
 * and as constraints the rules and fit checks evaluate. Section numbers in the
 * constraints point into the document.
 */

export interface HallRulesSeed {
  title: string;
  ruleText: string;
  constraints: HallConstraint[];
}

export const RULES_EFFECTIVE_FROM = "2026-09-01";

interface FridgeLimit {
  cubicFeet: string;
  liters: number;
}

const sharedConstraints = (fridge: FridgeLimit, perBedroom: boolean): HallConstraint[] => [
  {
    id: "no-halogen",
    section: "1.1",
    kind: "prohibited_item",
    summary: "Halogen lamps and bulbs are prohibited.",
    match: { categories: ["lamp"], bulbTypes: ["halogen"] },
  },
  {
    id: "refrigerator-limit",
    section: "1.2",
    kind: "category_limit",
    summary: `One refrigerator per ${perBedroom ? "bedroom" : "resident"}, ${fridge.cubicFeet} cubic feet (${fridge.liters} liters) or less, 180 watts or less.`,
    category: "mini_fridge",
    maxCapacityLiters: fridge.liters,
    maxWatts: 180,
    maxPerResident: 1,
  },
  {
    id: "no-open-flame",
    section: "2.1",
    kind: "prohibited_item",
    summary: "Candles, incense, and open flames are prohibited.",
    match: { keywords: ["candle", "incense", "lantern with flame"] },
  },
  {
    id: "egress-path",
    section: "2.2",
    kind: "egress_clearance",
    summary: "Keep a clear path at least 915 mm wide from each bed to the door.",
    minPathWidthMm: 915,
  },
];

function residenceHall(hallName: string, fridge: FridgeLimit): HallRulesSeed {
  return {
    title: `${hallName} room standards`,
    ruleText: `# ${hallName} room standards

${UNIVERSITY} Residential Life, 2026 to 2027 academic year. These standards apply to every room in ${hallName}. Staff check rooms at move in and during each quarterly safety inspection.

## 1. Electrical safety

1.1 Halogen lamps and halogen bulbs are prohibited. Use LED or compact fluorescent bulbs.

1.2 Each resident may keep one refrigerator of ${fridge.cubicFeet} cubic feet (${fridge.liters} liters) or less that draws no more than 1.5 amps (180 watts).

1.3 Space heaters, hot plates, toaster ovens, and other appliances with an exposed heating element are prohibited.

1.4 Power strips need a built in surge protector and plug into a wall outlet.

## 2. Fire safety

2.1 Candles, incense, and open flames are prohibited, including decorative candles that were never lit.

2.2 Keep a clear path at least 36 inches (915 mm) wide from each bed to the door.

2.3 Nothing may hang from a sprinkler head or cover a smoke detector.

## 3. Furniture

3.1 University furniture stays in the room for the whole academic year.

3.2 Only Facilities may loft or bunk a bed, using hall loft kits. Residents may raise a bed on risers that lift it 6 inches (152 mm) or less.

3.3 Nails, screws, and adhesive hooks are not allowed on walls, doors, or furniture. Over the door hooks and freestanding pieces are welcome.
`,
    constraints: [
      ...sharedConstraints(fridge, false),
      {
        id: "no-heating-appliances",
        section: "1.3",
        kind: "prohibited_item",
        summary: "Space heaters, hot plates, toaster ovens, and exposed heating elements are prohibited.",
        match: { keywords: ["space heater", "hot plate", "toaster oven", "heating element"] },
      },
      {
        id: "bed-lofting",
        section: "3.2",
        kind: "bed_lofting",
        summary: "Only Facilities lofts beds. Bed risers may lift a bed up to 152 mm.",
        residentLoftingAllowed: false,
        maxRiserLiftMm: 152,
      },
      {
        id: "wall-fasteners",
        section: "3.3",
        kind: "wall_mounting",
        summary: "No nails, screws, or adhesive hooks. Over the door hooks and freestanding pieces only.",
        fastenersAllowed: false,
      },
    ],
  };
}

export const HARBOR_HALL_RULES = residenceHall("Harbor Hall", { cubicFeet: "4.0", liters: 113 });

export const BIRCHWOOD_HOUSE_RULES = residenceHall("Birchwood House", { cubicFeet: "3.2", liters: 90 });

const breakwaterFridge: FridgeLimit = { cubicFeet: "4.5", liters: 127 };

export const BREAKWATER_APARTMENTS_RULES: HallRulesSeed = {
  title: "Breakwater Apartments bedroom standards",
  ruleText: `# Breakwater Apartments bedroom standards

${UNIVERSITY} Residential Life, 2026 to 2027 academic year. These standards apply to bedrooms in Breakwater Apartments. Each apartment shares a kitchen with a full size refrigerator, so bedroom appliances stay small.

## 1. Electrical safety

1.1 Halogen lamps and halogen bulbs are prohibited. Use LED or compact fluorescent bulbs.

1.2 Each bedroom may keep one compact refrigerator of ${breakwaterFridge.cubicFeet} cubic feet (${breakwaterFridge.liters} liters) or less that draws no more than 1.5 amps (180 watts).

1.3 Space heaters are prohibited. Cooking appliances belong in the kitchen.

## 2. Fire safety

2.1 Candles, incense, and open flames are prohibited anywhere in the apartment.

2.2 Keep a clear path at least 36 inches (915 mm) wide from the bed to the bedroom door.

## 3. Furniture and walls

3.1 Apartment furniture stays in the apartment for the length of the lease.

3.2 Beds may not be lofted. Residents may raise a bed on risers that lift it 6 inches (152 mm) or less.

3.3 Small picture nails are allowed for framed art and shelves rated for drywall. Adhesive hooks and strips are not allowed on painted walls.
`,
  constraints: [
    ...sharedConstraints(breakwaterFridge, true),
    {
      id: "no-space-heaters",
      section: "1.3",
      kind: "prohibited_item",
      summary: "Space heaters are prohibited, and cooking appliances stay in the kitchen.",
      match: { keywords: ["space heater", "hot plate", "toaster oven"] },
    },
    {
      id: "bed-lofting",
      section: "3.2",
      kind: "bed_lofting",
      summary: "Beds may not be lofted. Bed risers may lift a bed up to 152 mm.",
      residentLoftingAllowed: false,
      maxRiserLiftMm: 152,
    },
    {
      id: "wall-fasteners",
      section: "3.3",
      kind: "wall_mounting",
      summary: "Small picture nails are allowed. Adhesive hooks and strips are not.",
      fastenersAllowed: true,
    },
  ],
};
