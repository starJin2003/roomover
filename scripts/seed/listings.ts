import type { listings } from "@/lib/db/schema";
import type { HandoffMode, ListingCategory, ListingStatus, Placement } from "@/lib/domain/enums";
import {
  conditionReportSchema,
  listingColorsSchema,
  listingPhotosSchema,
  listingSpecsSchema,
  retailReferenceSchema,
  type ConditionGrade,
  type Defect,
  type ListingColor,
  type ListingSpecs,
} from "@/lib/domain/listing";
import { CAMPUS, campusCalendar, campusWindow, PRESET_SLUGS, type CampusDay, type Window } from "./campus";
import { seedId } from "./ids";
import { presetId, userId, type SellerSlug } from "./people";

export type SeedListing = typeof listings.$inferInsert & { id: string; photos: { src: string }[] };

interface HandoffPlan {
  mode: HandoffMode;
  moveOut: Window;
  moveIn: Window;
  room?: { presetSlug: string; number: string };
}

type HandoffKey = "avaWinter" | "avaStorage" | "marcusWinter" | "marcusStorage" | "junWinter" | "harbor214";

/**
 * Winter plans hand over during winter move in, inside one authorization from
 * a checkout on the seed day, so they authorize at checkout and capture at
 * handoff. Storage plans wait for fall move in, so they capture at checkout.
 */
function handoffPlans(seedDay: CampusDay): Record<HandoffKey, HandoffPlan> {
  const calendar = campusCalendar(seedDay);
  return {
    avaWinter: {
      mode: "direct",
      moveOut: campusWindow(seedDay, [9, "09:00"], [17, "20:00"]),
      moveIn: calendar.winterMoveIn,
    },
    avaStorage: { mode: "storage_hold", moveOut: calendar.springMoveOut, moveIn: calendar.fallMoveIn },
    marcusWinter: {
      mode: "direct",
      moveOut: campusWindow(seedDay, [10, "10:00"], [20, "20:00"]),
      moveIn: calendar.winterMoveIn,
    },
    // The lease ends two weeks after spring move out.
    marcusStorage: {
      mode: "storage_hold",
      moveOut: campusWindow(seedDay, [88, "09:00"], [93, "17:00"]),
      moveIn: calendar.fallMoveIn,
    },
    junWinter: {
      mode: "direct",
      moveOut: campusWindow(seedDay, [7, "09:00"], [16, "20:00"]),
      moveIn: calendar.winterMoveIn,
    },
    harbor214: {
      mode: "same_room",
      moveOut: calendar.fallMoveOut,
      moveIn: calendar.winterMoveIn,
      room: { presetSlug: PRESET_SLUGS.harborDouble, number: "214" },
    },
  };
}

interface ListingSeed {
  slug: string;
  seller: SellerSlug;
  status?: ListingStatus;
  category: ListingCategory;
  placement: Placement;
  title: string;
  description: string;
  color: string;
  /** Sampled from the photo, main color first. */
  colors: ListingColor[];
  material: string;
  styleTags: string[];
  /** Width, depth, and height in millimeters. */
  sizeMm: readonly [number, number, number];
  specs?: ListingSpecs;
  photo: { alt: string; widthPx: number; heightPx: number };
  condition: { grade: ConditionGrade; notes: string; defects?: Defect[] };
  retail: { productName: string; newPriceCents: number };
  priceCents: number;
  floorPriceCents: number;
  handoff: HandoffKey;
}

const RETAIL_NOTE = "Typical new price for this product class at US home goods retailers.";
const RETAIL_CHECKED_ON = "2026-11-08";

const CATALOG: ListingSeed[] = [
  // Ava Lindqvist, graduating. Extras go at winter move in, the rest after commencement.
  {
    slug: "ava-desk-lamp",
    seller: "ava",
    category: "lamp",
    placement: "surface",
    title: "Black balance arm desk lamp",
    description:
      "Matte black metal dome shade on a counterweighted arm with brass joints. Reaches across a full desk and comes with a warm white LED bulb.",
    color: "black and brass",
    colors: [{ name: "matte black", hex: "#1C1814" }, { name: "brass", hex: "#86713F" }],
    material: "metal",
    styleTags: ["industrial", "study", "warm light"],
    sizeMm: [420, 180, 480],
    specs: { bulbType: "led", watts: 9 },
    photo: { alt: "Black balance arm desk lamp with a brass collar lit on a wooden desk", widthPx: 942, heightPx: 1200 },
    condition: { grade: "like_new", notes: "Used one year on a desk. Joints hold their position." },
    retail: { productName: "Balance arm desk lamp with metal dome shade", newPriceCents: 4_900 },
    priceCents: 1_600,
    floorPriceCents: 1_200,
    handoff: "avaWinter",
  },
  {
    slug: "ava-floral-area-rug",
    seller: "ava",
    category: "rug",
    placement: "underlay",
    title: "Large ivory floral area rug, 8 by 10 feet",
    description:
      "Low pile rug with a muted beige, taupe, and blue floral pattern on an ivory ground. Covers most of a double room floor and goes under both beds.",
    color: "ivory and taupe",
    colors: [{ name: "ivory", hex: "#C4B9A7" }, { name: "taupe", hex: "#A59985" }],
    material: "low pile synthetic",
    styleTags: ["cozy", "traditional", "neutral"],
    sizeMm: [2440, 3050, 10],
    photo: { alt: "Ivory floral area rug on a dark wood floor in an empty living room", widthPx: 1024, heightPx: 832 },
    condition: { grade: "good", notes: "Vacuumed and spot cleaned. Pile is even with no stains." },
    retail: { productName: "8 by 10 ft low pile floral area rug", newPriceCents: 32_900 },
    priceCents: 8_500,
    floorPriceCents: 6_500,
    handoff: "avaWinter",
  },
  {
    slug: "ava-narrow-bookcases",
    seller: "ava",
    category: "shelf",
    placement: "floor",
    title: "Three narrow beech bookcases",
    description:
      "Three open bookcases in a light beech finish that stand side by side or apart. Each has three adjustable shelves.",
    color: "light beech",
    colors: [{ name: "light beech", hex: "#B07E38" }],
    material: "wood veneer",
    styleTags: ["minimal", "scandinavian", "study"],
    sizeMm: [400, 280, 1060],
    specs: { pieces: 3 },
    photo: { alt: "Three empty light wood bookcases against a gray cement wall", widthPx: 1200, heightPx: 800 },
    condition: { grade: "like_new", notes: "No chips on the edges. Shelf pins included." },
    retail: { productName: "Narrow open bookcase in beech, set of three", newPriceCents: 17_700 },
    priceCents: 4_500,
    floorPriceCents: 3_500,
    handoff: "avaStorage",
  },
  {
    slug: "ava-drawer-tower",
    seller: "ava",
    category: "storage",
    placement: "floor",
    title: "Four drawer plastic storage tower",
    description: "Black frame with four frosted drawers that slide out fully. Fits beside a desk or in a wardrobe.",
    color: "black and frosted clear",
    colors: [{ name: "black", hex: "#232027" }, { name: "frosted clear", hex: "#D2DAE2" }],
    material: "plastic",
    styleTags: ["practical", "compact"],
    sizeMm: [360, 300, 460],
    photo: { alt: "Black plastic four drawer storage tower with frosted drawers on a tile floor", widthPx: 900, heightPx: 1200 },
    condition: {
      grade: "good",
      notes: "All four drawers run smoothly.",
      defects: [{ location: "frame", description: "Light scuffs on the black top and sides", severity: "minor" }],
    },
    retail: { productName: "Four drawer plastic storage tower", newPriceCents: 2_900 },
    priceCents: 1_000,
    floorPriceCents: 700,
    handoff: "avaStorage",
  },

  // Marcus Bell, lease end. In town all winter, apartment furniture goes to storage when the lease ends.
  {
    slug: "marcus-mesh-desk-chair",
    seller: "marcus",
    category: "chair",
    placement: "floor",
    title: "Mesh back rolling desk chair",
    description:
      "Black mesh back, gray padded seat, fixed arms, and a five star base on casters. Height adjusts for a standard desk.",
    color: "black and gray",
    colors: [{ name: "black mesh", hex: "#2C282A" }, { name: "gray seat", hex: "#4B494A" }],
    material: "mesh and vinyl",
    styleTags: ["study", "ergonomic"],
    sizeMm: [630, 600, 950],
    photo: { alt: "Rolling desk chair with a black mesh back and gray seat on striped carpet", widthPx: 900, heightPx: 1200 },
    condition: {
      grade: "good",
      notes: "Gas lift holds height. Casters roll freely.",
      defects: [{ location: "seat", description: "Light creases in the vinyl seat cover", severity: "minor" }],
    },
    retail: { productName: "Mesh back task chair with arms", newPriceCents: 14_900 },
    priceCents: 3_500,
    floorPriceCents: 2_500,
    handoff: "marcusWinter",
  },
  {
    slug: "marcus-green-floor-lamp",
    seller: "marcus",
    category: "lamp",
    placement: "floor",
    title: "Green metal floor reading lamp, halogen bulb",
    description:
      "Tall reading lamp with a tilting green dome shade and a white interior. Takes a 150 watt halogen bulb. Most residence halls prohibit halogen.",
    color: "green",
    colors: [{ name: "green", hex: "#1B6E0B" }],
    material: "painted metal",
    styleTags: ["retro", "reading"],
    sizeMm: [300, 300, 1500],
    specs: { bulbType: "halogen", watts: 150 },
    photo: { alt: "Green metal floor lamp with a dome shade against a sage green wall", widthPx: 1200, heightPx: 1046 },
    condition: {
      grade: "fair",
      notes: "Works and tilts. The paint shows its age.",
      defects: [{ location: "shade and pole", description: "Patchy, worn paint", severity: "moderate" }],
    },
    retail: { productName: "Metal floor reading lamp with dome shade", newPriceCents: 4_900 },
    priceCents: 1_200,
    floorPriceCents: 800,
    handoff: "marcusWinter",
  },
  {
    slug: "marcus-oak-writing-table",
    seller: "marcus",
    category: "desk",
    placement: "floor",
    title: "Vintage oak writing table with leather top",
    description:
      "Solid oak table with a dark green leather inset, two locking drawers, and clustered column legs. A family piece that does not fit the next apartment.",
    color: "honey oak and dark green",
    colors: [{ name: "honey oak", hex: "#B47358" }, { name: "dark green leather", hex: "#4A4D45" }],
    material: "solid oak and leather",
    styleTags: ["vintage", "statement", "study"],
    sizeMm: [1220, 760, 760],
    photo: { alt: "Oak writing table with a green leather top and two drawers on a white background", widthPx: 1024, heightPx: 813 },
    condition: {
      grade: "good",
      notes: "Sturdy with no wobble. Drawer keys are missing.",
      defects: [{ location: "top edge", description: "Minor wear along the front edge of the top", severity: "minor" }],
    },
    retail: { productName: "Solid oak writing table with leather inset and two drawers", newPriceCents: 89_900 },
    priceCents: 18_000,
    floorPriceCents: 14_000,
    handoff: "marcusStorage",
  },
  {
    slug: "marcus-bell-floor-lamp",
    seller: "marcus",
    category: "lamp",
    placement: "floor",
    title: "Floor lamp with cream bell shade",
    description:
      "Bronze finish pole with a cream satin bell shade and a fabric rosette. Gives soft light for a reading corner.",
    color: "cream and bronze",
    colors: [{ name: "cream shade", hex: "#B5A669" }, { name: "bronze", hex: "#462712" }],
    material: "metal and fabric",
    styleTags: ["cozy", "traditional", "warm light"],
    sizeMm: [400, 400, 1600],
    specs: { bulbType: "led", watts: 10 },
    photo: { alt: "Floor lamp with a cream bell shade in front of a bamboo blind", widthPx: 735, heightPx: 1200 },
    condition: {
      grade: "good",
      notes: "Shade is clean and straight.",
      defects: [{ location: "pole", description: "Small chip in the bronze finish", severity: "minor" }],
    },
    retail: { productName: "Floor lamp with fabric bell shade", newPriceCents: 6_900 },
    priceCents: 1_800,
    floorPriceCents: 1_200,
    handoff: "marcusStorage",
  },
  {
    slug: "marcus-mustard-armchair",
    seller: "marcus",
    category: "chair",
    placement: "floor",
    title: "Mustard wingback lounge chair",
    description:
      "Button tufted wingback in mustard yellow fabric on tapered light wood legs. The most comfortable seat in the apartment.",
    color: "mustard yellow",
    colors: [{ name: "mustard yellow", hex: "#EC9902" }, { name: "oak legs", hex: "#D58632" }],
    material: "fabric and wood",
    styleTags: ["cozy", "mid century", "statement"],
    sizeMm: [760, 800, 920],
    photo: { alt: "Mustard yellow wingback armchair beside a small wooden cube table", widthPx: 1200, heightPx: 800 },
    condition: {
      grade: "fair",
      notes: "Frame and legs are solid. Fabric needs a clean.",
      defects: [
        { location: "arms", description: "Light pilling and soiling", severity: "minor" },
        { location: "front seat edge", description: "Darkened fabric from wear", severity: "minor" },
      ],
    },
    retail: { productName: "Upholstered wingback lounge chair", newPriceCents: 29_900 },
    priceCents: 6_500,
    floorPriceCents: 5_000,
    handoff: "marcusStorage",
  },

  // Sofia Navarro, transfer. Leaves a set up half of Harbor Hall 214.
  {
    slug: "sofia-reversible-comforter",
    seller: "sofia",
    category: "bed_accessory",
    placement: "bed",
    title: "Reversible comforter, blue and cream print",
    description:
      "Full size comforter with a light blue side and a cream side printed in brown geometric blocks. Generous on a twin extra long bed.",
    color: "light blue and cream",
    colors: [{ name: "light blue", hex: "#8190AA" }, { name: "cream print", hex: "#BEBBBD" }],
    material: "cotton",
    styleTags: ["cozy", "pattern"],
    sizeMm: [2030, 2290, 40],
    photo: { alt: "Reversible comforter in light blue and a cream geometric print on a bed", widthPx: 768, heightPx: 1024 },
    condition: { grade: "good", notes: "Washed before listing. No stains or tears." },
    retail: { productName: "Reversible cotton comforter, full size", newPriceCents: 7_900 },
    priceCents: 2_200,
    floorPriceCents: 1_500,
    handoff: "harbor214",
  },
  {
    slug: "sofia-bed-pillows",
    seller: "sofia",
    category: "bed_accessory",
    placement: "bed",
    title: "Three standard bed pillows",
    description: "Medium firm pillows with zippered protectors under washable white cases.",
    color: "white",
    colors: [{ name: "white", hex: "#C8C6C7" }],
    material: "polyester fill and cotton",
    styleTags: ["practical"],
    sizeMm: [510, 660, 150],
    specs: { pieces: 3 },
    photo: { alt: "Three white bed pillows against a honey wood headboard", widthPx: 1200, heightPx: 900 },
    condition: { grade: "like_new", notes: "Used one quarter with protectors. Cases washed." },
    retail: { productName: "Standard bed pillows, set of three", newPriceCents: 4_500 },
    priceCents: 1_200,
    floorPriceCents: 800,
    handoff: "harbor214",
  },
  {
    slug: "sofia-blue-drawer-unit",
    seller: "sofia",
    category: "storage",
    placement: "surface",
    title: "Five drawer desktop organizer, blue",
    description: "Bright blue frame with five clear drawers for chargers, stationery, and small things. Sits on a desk or shelf.",
    color: "blue and clear",
    colors: [{ name: "blue", hex: "#3768AE" }, { name: "clear drawers", hex: "#929AAF" }],
    material: "plastic",
    styleTags: ["practical", "bright"],
    sizeMm: [280, 360, 450],
    photo: { alt: "Blue plastic organizer with five clear drawers in front of a cork board", widthPx: 900, heightPx: 1200 },
    condition: { grade: "like_new", notes: "Empty and clean. Every drawer slides." },
    retail: { productName: "Five drawer desktop organizer", newPriceCents: 2_500 },
    priceCents: 900,
    floorPriceCents: 600,
    handoff: "harbor214",
  },
  {
    slug: "sofia-clamp-lamp",
    seller: "sofia",
    category: "lamp",
    placement: "surface",
    title: "Black clamp lamp",
    description: "Small black metal reading lamp on a jointed arm. Clamps to a bed frame or desk edge and swivels toward the page.",
    color: "black",
    colors: [{ name: "black", hex: "#444444" }],
    material: "metal",
    styleTags: ["study", "compact"],
    sizeMm: [150, 150, 450],
    specs: { bulbType: "led", watts: 7 },
    photo: { alt: "Head of a black metal clamp lamp on a jointed arm against a white background", widthPx: 1198, heightPx: 1200 },
    condition: {
      grade: "good",
      notes: "Switch and joints work.",
      defects: [{ location: "shade rim", description: "Light scratches and dust in the matte finish", severity: "minor" }],
    },
    retail: { productName: "Clamp reading lamp with metal shade", newPriceCents: 2_200 },
    priceCents: 800,
    floorPriceCents: 500,
    handoff: "harbor214",
  },
  {
    slug: "sofia-woven-baskets",
    seller: "sofia",
    category: "storage",
    placement: "floor",
    title: "Two woven grass baskets",
    description:
      "Handwoven baskets with leather wrapped handles, one in pink and teal stripes and one in green and orange. Hold laundry, blankets, or shoes.",
    color: "pink, teal, green, and orange",
    colors: [{ name: "pink", hex: "#D85977" }, { name: "teal", hex: "#5B8897" }, { name: "green", hex: "#93AB81" }, { name: "orange", hex: "#DEAB70" }],
    material: "woven grass and leather",
    styleTags: ["colorful", "handmade", "cozy"],
    sizeMm: [420, 420, 330],
    specs: { pieces: 2 },
    photo: { alt: "Two colorful woven grass baskets hanging under a blue beam", widthPx: 1200, heightPx: 562 },
    condition: { grade: "like_new", notes: "Tight weave with no broken strands." },
    retail: { productName: "Handwoven grass storage basket, pair", newPriceCents: 6_000 },
    priceCents: 1_400,
    floorPriceCents: 1_000,
    handoff: "harbor214",
  },

  // Jun Park, leave of absence. Stays nearby and meets buyers on campus until winter move in ends.
  {
    slug: "jun-white-desk",
    seller: "jun",
    category: "desk",
    placement: "floor",
    title: "White three drawer desk with oak legs",
    description:
      "Matte white top with three shallow drawers on splayed solid oak legs. Wide enough for a laptop, a monitor, and notes.",
    color: "white and light oak",
    colors: [{ name: "white", hex: "#C7C3C2" }, { name: "light oak legs", hex: "#B48A5E" }],
    material: "lacquered wood and oak",
    styleTags: ["minimal", "scandinavian", "study"],
    sizeMm: [1200, 500, 750],
    photo: { alt: "White desk with three drawers and oak legs in a bright room", widthPx: 560, heightPx: 640 },
    condition: { grade: "good", notes: "Drawers slide smoothly. The top wipes clean with no marks." },
    retail: { productName: "Desk with three drawers and solid oak legs", newPriceCents: 19_900 },
    priceCents: 5_500,
    floorPriceCents: 4_000,
    handoff: "junWinter",
  },
  {
    slug: "jun-velvet-side-chair",
    seller: "jun",
    category: "chair",
    placement: "floor",
    title: "Black wood chair with red velvet seat",
    description: "Curved black lacquered frame with a padded red velvet seat and brass nail trim. Works as a desk or guest chair.",
    color: "black and red",
    colors: [{ name: "black", hex: "#181A1F" }, { name: "red velvet", hex: "#9C292B" }],
    material: "lacquered wood and velvet",
    styleTags: ["vintage", "statement"],
    sizeMm: [450, 500, 900],
    photo: { alt: "Black wooden chair with a red velvet seat in a room corner", widthPx: 818, heightPx: 1200 },
    condition: {
      grade: "fair",
      notes: "Steady on all four legs.",
      defects: [
        { location: "seat", description: "Velvet worn flat in places", severity: "minor" },
        { location: "front legs", description: "Small chips in the black finish", severity: "minor" },
      ],
    },
    retail: { productName: "Upholstered wood side chair", newPriceCents: 8_900 },
    priceCents: 2_000,
    floorPriceCents: 1_400,
    handoff: "junWinter",
  },
  {
    slug: "jun-compact-fridge",
    seller: "jun",
    category: "mini_fridge",
    placement: "floor",
    title: "Compact black fridge, 1.7 cubic feet",
    description:
      "Quiet single door fridge that fits under a desk or in a cabinet cubby. Holds drinks, snacks, and a week of leftovers.",
    color: "black",
    colors: [{ name: "black", hex: "#2E2B1D" }],
    material: "steel and plastic",
    styleTags: ["practical", "compact"],
    sizeMm: [445, 470, 510],
    specs: { capacityLiters: 48, watts: 70, hasFreezer: false },
    photo: { alt: "Compact black fridge standing in a wooden cabinet cubby", widthPx: 1200, heightPx: 947 },
    condition: { grade: "good", notes: "Defrosted and cleaned inside. Door seal holds." },
    retail: { productName: "1.7 cubic foot compact refrigerator", newPriceCents: 13_900 },
    priceCents: 4_500,
    floorPriceCents: 3_500,
    handoff: "junWinter",
  },
  {
    slug: "jun-round-jute-rug",
    seller: "jun",
    category: "rug",
    placement: "underlay",
    title: "Round jute and cotton rug, 4 feet",
    description: "Braided rug in undyed jute with a cream cotton ring and a short fringe. Warms up the floor between the bed and the desk.",
    color: "tan and cream",
    colors: [{ name: "tan jute", hex: "#967553" }, { name: "cream stripe", hex: "#B9A999" }],
    material: "jute and cotton",
    styleTags: ["cozy", "earthy", "boho"],
    sizeMm: [1220, 1220, 10],
    photo: { alt: "Round jute rug with a cream stripe and fringe on gray carpet", widthPx: 1200, heightPx: 754 },
    condition: {
      grade: "good",
      notes: "Lies flat and was vacuumed.",
      defects: [{ location: "fringe", description: "A few loose fringe strands", severity: "minor" }],
    },
    retail: { productName: "4 ft round jute and cotton rug", newPriceCents: 6_900 },
    priceCents: 2_200,
    floorPriceCents: 1_500,
    handoff: "junWinter",
  },

  // Lea Moreau, exchange. Flies home after fall move out and leaves the room essentials in Harbor Hall 214.
  {
    slug: "lea-navy-bean-bag",
    seller: "lea",
    category: "chair",
    placement: "floor",
    title: "Navy bean bag chair with matching pouf",
    description:
      "Faux leather bean bag with a sewn backrest, a loose cushion, and a small round pouf for your feet. Wipes clean.",
    color: "navy",
    colors: [{ name: "navy", hex: "#1C283A" }],
    material: "faux leather",
    styleTags: ["cozy", "lounge"],
    sizeMm: [900, 900, 800],
    photo: { alt: "Navy faux leather bean bag chair and round pouf on a white tile floor", widthPx: 1000, heightPx: 700 },
    condition: { grade: "good", notes: "Full of filling with no leaks. Seams intact." },
    retail: { productName: "Faux leather bean bag chair with pouf", newPriceCents: 12_900 },
    priceCents: 3_000,
    floorPriceCents: 2_200,
    handoff: "harbor214",
  },
  {
    slug: "lea-crochet-throw",
    seller: "lea",
    category: "bed_accessory",
    placement: "bed",
    title: "Granny square crochet throw",
    description: "Handmade throw in navy, sky blue, sage, and butter yellow squares. Warm enough for late study nights.",
    color: "blue, green, and yellow",
    colors: [{ name: "blue", hex: "#42678F" }, { name: "green", hex: "#425B42" }, { name: "yellow", hex: "#F1E2B3" }],
    material: "acrylic yarn",
    styleTags: ["cozy", "handmade", "colorful"],
    sizeMm: [1270, 1520, 15],
    photo: { alt: "Close view of a crochet throw made of blue, green, and yellow granny squares", widthPx: 675, heightPx: 1200 },
    condition: { grade: "like_new", notes: "Washed on gentle. No pulled stitches." },
    retail: { productName: "Handmade crochet throw blanket", newPriceCents: 8_500 },
    priceCents: 1_800,
    floorPriceCents: 1_200,
    handoff: "harbor214",
  },
  {
    slug: "lea-brass-table-lamp",
    seller: "lea",
    category: "lamp",
    placement: "surface",
    title: "Brass table lamp with linen shade",
    description: "Antique brass urn base with a glass bead and a tapered linen shade. Soft bedside light from a warm LED bulb.",
    color: "brass and beige",
    colors: [{ name: "brass", hex: "#8E6B45" }, { name: "beige linen", hex: "#EBE0CB" }],
    material: "metal, glass, and linen",
    styleTags: ["cozy", "traditional", "warm light"],
    sizeMm: [300, 300, 520],
    specs: { bulbType: "led", watts: 8 },
    photo: { alt: "Brass table lamp with a beige linen shade on a wooden nightstand", widthPx: 866, heightPx: 1200 },
    condition: { grade: "good", notes: "Shade is straight and clean. In line switch on the cord." },
    retail: { productName: "Brass urn table lamp with linen shade", newPriceCents: 5_900 },
    priceCents: 1_500,
    floorPriceCents: 1_000,
    handoff: "harbor214",
  },
  {
    slug: "lea-kilim-rug",
    seller: "lea",
    category: "rug",
    placement: "underlay",
    title: "Flat weave kilim rug, red and cream",
    description: "Thin flat weave rug with red, rose, and cream stripes and chevrons. Slides under a bed or runs beside it.",
    color: "red and cream",
    colors: [{ name: "red", hex: "#682625" }, { name: "cream", hex: "#C3B393" }],
    material: "wool flat weave",
    styleTags: ["pattern", "vintage", "boho"],
    sizeMm: [1220, 2130, 5],
    photo: { alt: "Flat weave kilim rug with red and cream stripes laid flat", widthPx: 1200, heightPx: 678 },
    condition: {
      grade: "fair",
      notes: "Colors are bright. Edges show age.",
      defects: [
        { location: "short ends", description: "Frayed warp threads", severity: "minor" },
        { location: "right side", description: "Small worn patch in the weave", severity: "moderate" },
      ],
    },
    retail: { productName: "Flat weave kilim area rug, 4 by 7 ft", newPriceCents: 14_900 },
    priceCents: 2_500,
    floorPriceCents: 1_800,
    handoff: "harbor214",
  },
  {
    slug: "lea-felt-poufs",
    seller: "lea",
    category: "chair",
    placement: "floor",
    title: "Three round felt poufs",
    description: "Charcoal, red, and orange felt poufs that work as extra seats for friends or as footrests.",
    color: "charcoal, red, and orange",
    colors: [{ name: "charcoal", hex: "#585553" }, { name: "red", hex: "#A9514A" }, { name: "orange", hex: "#BA6D4A" }],
    material: "wool felt",
    styleTags: ["colorful", "lounge"],
    sizeMm: [500, 500, 420],
    specs: { pieces: 3 },
    photo: { alt: "Charcoal, red, and orange round felt poufs on a wood floor", widthPx: 1200, heightPx: 591 },
    condition: { grade: "like_new", notes: "Firm with no pilling." },
    retail: { productName: "Round felt pouf, set of three", newPriceCents: 17_700 },
    priceCents: 3_500,
    floorPriceCents: 2_500,
    handoff: "harbor214",
  },
  {
    slug: "lea-moving-tote",
    seller: "lea",
    category: "storage",
    placement: "bed",
    title: "Orange storage tote with attached lid",
    description: "Stackable tote with interlocking lid flaps. Slides under a raised bed and doubles as a moving box at the end of the year.",
    color: "orange",
    colors: [{ name: "orange", hex: "#C27116" }],
    material: "plastic",
    styleTags: ["practical"],
    sizeMm: [690, 450, 330],
    photo: { alt: "Empty orange storage tote with open attached lid flaps", widthPx: 1200, heightPx: 751 },
    condition: {
      grade: "fair",
      notes: "Lid flaps close and lock.",
      defects: [{ location: "inside walls", description: "Scuffs and a few marker marks", severity: "minor" }],
    },
    retail: { productName: "Attached lid storage tote", newPriceCents: 3_500 },
    priceCents: 1_000,
    floorPriceCents: 700,
    handoff: "harbor214",
  },
];

function toRow(item: ListingSeed, handoff: HandoffPlan): SeedListing {
  return {
    id: seedId("listing", item.slug),
    sellerId: userId(item.seller),
    campus: CAMPUS,
    category: item.category,
    placement: item.placement,
    title: item.title,
    description: item.description,
    color: item.color,
    colors: listingColorsSchema.parse(item.colors),
    material: item.material,
    styleTags: item.styleTags,
    widthMm: item.sizeMm[0],
    depthMm: item.sizeMm[1],
    heightMm: item.sizeMm[2],
    specs: listingSpecsSchema.parse(item.specs ?? {}),
    photos: listingPhotosSchema.parse([{ src: `/seed/listings/${item.slug}.jpg`, ...item.photo }]),
    conditionReport: conditionReportSchema.parse({
      grade: item.condition.grade,
      notes: item.condition.notes,
      defects: item.condition.defects ?? [],
      assessedBy: "seller",
    }),
    retailReference: retailReferenceSchema.parse({
      productName: item.retail.productName,
      newPriceCents: item.retail.newPriceCents,
      source: "seed_estimate",
      sourceNote: RETAIL_NOTE,
      checkedOn: RETAIL_CHECKED_ON,
    }),
    priceCents: item.priceCents,
    floorPriceCents: item.floorPriceCents,
    moveOutStartsAt: handoff.moveOut.startsAt,
    moveOutEndsAt: handoff.moveOut.endsAt,
    moveInStartsAt: handoff.moveIn.startsAt,
    moveInEndsAt: handoff.moveIn.endsAt,
    handoffMode: handoff.mode,
    roomPresetId: handoff.room === undefined ? null : presetId(handoff.room.presetSlug),
    roomNumber: handoff.room?.number ?? null,
    status: item.status ?? "active",
  };
}

export function seedListings(seedDay: CampusDay): SeedListing[] {
  const plans = handoffPlans(seedDay);
  return CATALOG.map((item) => toRow(item, plans[item.handoff]));
}
