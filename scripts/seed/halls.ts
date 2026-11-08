import type { hallRules, halls, roomPresets } from "@/lib/db/schema";
import { roomGeometrySchema, type RoomGeometry } from "@/lib/domain/room";
import { CAMPUS, PRESET_SLUGS } from "./campus";
import {
  BIRCHWOOD_HOUSE_RULES,
  BREAKWATER_APARTMENTS_RULES,
  HARBOR_HALL_RULES,
  RULES_EFFECTIVE_FROM,
  type HallRulesSeed,
} from "./hall-rules";
import { seedId } from "./ids";
import { presetId } from "./people";

export type SeedHall = typeof halls.$inferInsert & { id: string };
export type SeedRoomPreset = typeof roomPresets.$inferInsert & { id: string; geometry: RoomGeometry };
export type SeedHallRules = typeof hallRules.$inferInsert & { id: string };

const hallId = (slug: string) => seedId("hall", slug);

const HALLS = [
  {
    slug: "harbor-hall",
    name: "Harbor Hall",
    description: "Corridor style residence hall of double rooms with community bathrooms and steam radiators.",
    rules: HARBOR_HALL_RULES,
  },
  {
    slug: "birchwood-house",
    name: "Birchwood House",
    description: "Residence hall of single rooms with community bathrooms and a heating and cooling unit in every room.",
    rules: BIRCHWOOD_HOUSE_RULES,
  },
  {
    slug: "breakwater-apartments",
    name: "Breakwater Apartments",
    description: "University apartments with private bedrooms, a shared kitchen, and a living room.",
    rules: BREAKWATER_APARTMENTS_RULES,
  },
] satisfies { slug: string; name: string; description: string; rules: HallRulesSeed }[];

/**
 * Furniture the university provides, at the sizes residential services
 * publishes. A twin extra long mattress is 914 by 2032 mm, the bed frame sits
 * 559 mm off the floor, desks and wardrobes are 1067 mm wide, and the desk
 * chair is 521 by 457 mm.
 */
const TWIN_XL_BED = { kind: "bed", widthMm: 914, depthMm: 2032, heightMm: 762 } as const;
const WARDROBE = { kind: "wardrobe", widthMm: 1067, depthMm: 610, heightMm: 1829 } as const;
const DESK = { kind: "desk", widthMm: 1067, depthMm: 610, heightMm: 762 } as const;
const DESK_CHAIR = { kind: "desk_chair", widthMm: 521, depthMm: 457, heightMm: 826 } as const;

/**
 * Double room with the window wall on the north and the corridor door on the
 * south. Each resident has a wardrobe beside the door, a bed along a long wall
 * with its head toward the door, and a desk in a window corner.
 */
const HARBOR_DOUBLE: RoomGeometry = {
  doors: [{ wall: "south", offsetMm: 1368, widthMm: 864, heightMm: 2032, swing: "in", hinge: "right" }],
  windows: [
    { wall: "north", offsetMm: 300, widthMm: 699, heightMm: 1321, sillHeightMm: 800 },
    { wall: "north", offsetMm: 1450, widthMm: 699, heightMm: 1321, sillHeightMm: 800 },
    { wall: "north", offsetMm: 2600, widthMm: 699, heightMm: 1321, sillHeightMm: 800 },
  ],
  fixtures: [
    { ...WARDROBE, label: "West wardrobe", xMm: 534, yMm: 4195, rotationDeg: 180 },
    { ...WARDROBE, label: "East wardrobe", xMm: 3066, yMm: 4195, rotationDeg: 180 },
    { ...TWIN_XL_BED, label: "West bed", xMm: 457, yMm: 2874, rotationDeg: 180 },
    { ...TWIN_XL_BED, label: "East bed", xMm: 3143, yMm: 2874, rotationDeg: 180 },
    { ...DESK, label: "West desk", xMm: 534, yMm: 305, rotationDeg: 0 },
    { ...DESK, label: "East desk", xMm: 3066, yMm: 305, rotationDeg: 0 },
    { ...DESK_CHAIR, label: "West desk chair", xMm: 534, yMm: 900, rotationDeg: 180 },
    { ...DESK_CHAIR, label: "East desk chair", xMm: 3066, yMm: 900, rotationDeg: 180 },
    { kind: "radiator", label: "Steam radiator", xMm: 1800, yMm: 100, widthMm: 900, depthMm: 200, heightMm: 600, rotationDeg: 0 },
  ],
};

/**
 * Single room with the window on the north wall and the corridor door at the
 * east end of the south wall. The bed runs along the west wall with its head
 * at the window, and the desk stands against the east wall.
 */
const BIRCHWOOD_SINGLE: RoomGeometry = {
  doors: [{ wall: "south", offsetMm: 1920, widthMm: 830, heightMm: 2032, swing: "in", hinge: "left" }],
  windows: [{ wall: "north", offsetMm: 1350, widthMm: 1016, heightMm: 1397, sillHeightMm: 800 }],
  fixtures: [
    { ...WARDROBE, label: "Wardrobe", xMm: 534, yMm: 3295, rotationDeg: 180 },
    { ...TWIN_XL_BED, label: "Bed", xMm: 457, yMm: 1016, rotationDeg: 0 },
    { ...DESK, label: "Desk", xMm: 2495, yMm: 1500, rotationDeg: 90 },
    { ...DESK_CHAIR, label: "Desk chair", xMm: 1910, yMm: 1500, rotationDeg: 270 },
    { kind: "radiator", label: "Heating and cooling unit", xMm: 1830, yMm: 153, widthMm: 1067, depthMm: 305, heightMm: 600, rotationDeg: 0 },
  ],
};

/**
 * Apartment bedroom with the window centered on the north wall above a
 * baseboard heater and the door near the south end of the east wall. A queen
 * bed runs east from the west wall, with a nightstand, a desk, and two dresser
 * cubes around it.
 */
const BREAKWATER_BEDROOM: RoomGeometry = {
  doors: [{ wall: "east", offsetMm: 3608, widthMm: 864, heightMm: 2032, swing: "in", hinge: "right" }],
  windows: [{ wall: "north", offsetMm: 761, widthMm: 1220, heightMm: 1220, sillHeightMm: 790 }],
  fixtures: [
    { kind: "bed", label: "Queen bed", xMm: 1016, yMm: 2362, widthMm: 1524, depthMm: 2032, heightMm: 610, rotationDeg: 270 },
    { kind: "dresser", label: "Nightstand", xMm: 200, yMm: 1350, widthMm: 450, depthMm: 400, heightMm: 560, rotationDeg: 270 },
    { ...DESK, label: "Desk", xMm: 305, yMm: 534, rotationDeg: 270 },
    { ...DESK_CHAIR, label: "Desk chair", xMm: 900, yMm: 534, rotationDeg: 90 },
    { kind: "dresser", label: "Dresser cube", xMm: 220, yMm: 4367, widthMm: 410, depthMm: 410, heightMm: 560, rotationDeg: 180 },
    { kind: "dresser", label: "Dresser cube", xMm: 640, yMm: 4367, widthMm: 410, depthMm: 410, heightMm: 560, rotationDeg: 180 },
    { kind: "radiator", label: "Baseboard heater", xMm: 1372, yMm: 50, widthMm: 1500, depthMm: 100, heightMm: 200, rotationDeg: 0 },
  ],
};

const PRESETS = [
  {
    slug: PRESET_SLUGS.harborDouble,
    hallSlug: "harbor-hall",
    name: "Harbor Hall double",
    roomType: "double",
    occupancy: 2,
    widthMm: 3600,
    depthMm: 4500,
    ceilingHeightMm: 2440,
    geometry: HARBOR_DOUBLE,
    estimatedFields: ["widthMm", "depthMm", "ceilingHeightMm", "doors", "windows.position", "windows.sillHeightMm", "fixtures.position", "fixtures.radiator"],
  },
  {
    slug: PRESET_SLUGS.birchwoodSingle,
    hallSlug: "birchwood-house",
    name: "Birchwood House single",
    roomType: "single",
    occupancy: 1,
    widthMm: 2800,
    depthMm: 3600,
    ceilingHeightMm: 2440,
    geometry: BIRCHWOOD_SINGLE,
    estimatedFields: ["widthMm", "depthMm", "ceilingHeightMm", "doors", "windows.position", "windows.sillHeightMm", "fixtures.position", "fixtures.radiator"],
  },
  {
    slug: PRESET_SLUGS.breakwaterBedroom,
    hallSlug: "breakwater-apartments",
    name: "Breakwater Apartments bedroom",
    roomType: "apartment_bedroom",
    occupancy: 1,
    widthMm: 2743,
    depthMm: 4572,
    ceilingHeightMm: 2440,
    geometry: BREAKWATER_BEDROOM,
    estimatedFields: ["ceilingHeightMm", "doors", "windows", "fixtures"],
  },
] as const;

export function seedHalls(): SeedHall[] {
  return HALLS.map(({ slug, name, description }) => ({ id: hallId(slug), campus: CAMPUS, slug, name, description }));
}

export function seedRoomPresets(): SeedRoomPreset[] {
  return PRESETS.map(({ hallSlug, geometry, estimatedFields, ...preset }) => ({
    ...preset,
    id: presetId(preset.slug),
    hallId: hallId(hallSlug),
    geometry: roomGeometrySchema.parse(geometry),
    estimatedFields: [...estimatedFields],
  }));
}

export function seedHallRules(): SeedHallRules[] {
  return HALLS.map(({ slug, rules }) => ({
    id: seedId("hall-rules", slug),
    hallId: hallId(slug),
    title: rules.title,
    ruleText: rules.ruleText,
    constraints: rules.constraints,
    effectiveFrom: RULES_EFFECTIVE_FROM,
  }));
}
