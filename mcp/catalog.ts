import { z } from "zod";
import type { CatalogListing } from "@/lib/agents/buyer/context";
import type { PresetWithRules } from "@/lib/db/plans";
import { LISTING_CATEGORIES, type HandoffMode } from "@/lib/domain/enums";
import { hallRuleViolations } from "@/lib/domain/hall-check";
import type { HallConstraint } from "@/lib/domain/hall-rules";
import { CONDITION_LABEL, formatCentimeters, formatDayRange, formatInches, formatUsdShort } from "@/lib/format";
import { absoluteUrl } from "@/lib/site";

/**
 * What an outside assistant reads before it plans a room: the used items on
 * sale and the rooms they can go in. Both answers come from the same catalog
 * the buyer agent searches, and neither names a seller's floor price.
 */

const MM_PER_INCH = 25.4;

export const searchListingsInput = z.object({
  campus: z.string().max(80).optional().describe('The campus to search. The demo runs at one campus, "Lakeshore University", which is also the default.'),
  category: z.enum(LISTING_CATEGORIES).optional().describe("Only items of this kind. bed_accessory covers comforters, throws, and pillows."),
  query: z.string().max(80).optional().describe('Words to match in titles, descriptions, colors, and styles, such as "warm brass lamp".'),
  maxPriceDollars: z.number().positive().max(2000).optional().describe("The most the student wants to pay for one item, in US dollars."),
  maxWidthInches: z.number().positive().max(200).optional().describe("The widest one piece may be, in inches."),
  maxDepthInches: z.number().positive().max(200).optional().describe("The deepest one piece may be, in inches."),
  maxHeightInches: z.number().positive().max(120).optional().describe("The tallest one piece may be, in inches."),
  roomPresetSlug: z.string().max(80).optional().describe("A room from get_room_presets. Only items that room can take come back, including items a leaving student keeps in that room for its next student."),
  limit: z.number().int().min(1).max(24).optional().describe("How many items to return, 12 by default."),
});
export type SearchListingsInput = z.infer<typeof searchListingsInput>;

export const listingResultSchema = z.object({
  listingId: z.uuid(),
  title: z.string(),
  category: z.enum(LISTING_CATEGORIES),
  condition: z.string(),
  price: z.string(),
  priceCents: z.number().int(),
  seller: z.string(),
  size: z.string(),
  pieces: z.number().int(),
  color: z.string(),
  styleTags: z.array(z.string()),
  handoff: z.string(),
  photoUrl: z.string(),
  breaksHallRule: z.string().nullable(),
});
export type ListingResult = z.infer<typeof listingResultSchema>;

export const searchListingsOutput = z.object({ campus: z.string(), count: z.number().int(), listings: z.array(listingResultSchema) });
export type SearchListingsOutput = z.infer<typeof searchListingsOutput>;

/** The parts of a listing the buyer agent's catalog leaves out. */
export interface ListingExtras {
  handoffMode: HandoffMode;
  photoSrc: string;
}

export interface SearchScope {
  campusSlug: string;
  campusName: string;
  /** The room the search is for, which decides whether same room items show and which hall's rules apply. */
  room: { roomPresetId: string; roomNumber: string | null; hallName: string; constraints: readonly HallConstraint[] } | null;
  appUrl: string;
}

const firstName = (name: string) => name.split(" ")[0];

function handoffWords(listing: CatalogListing, mode: HandoffMode, roomLabel: string | null): string {
  const window = listing.pickup === null ? "" : `, ${formatDayRange(listing.pickup.startsAt, listing.pickup.endsAt)}`;
  if (mode === "same_room") return `Stays in ${roomLabel ?? "its room"} for the student moving in there${window}`;
  if (mode === "storage_hold") return `Waits in campus storage after ${firstName(listing.sellerName)} moves out, ready to collect${window}`;
  return `Handed over in person by ${firstName(listing.sellerName)}${window}`;
}

/** Whether the campus the assistant named is the demo campus, by its slug or its name. */
export function campusMatches(asked: string | undefined, scope: Pick<SearchScope, "campusSlug" | "campusName">): boolean {
  if (asked === undefined) return true;
  const plain = (text: string) => text.toLowerCase().replace(/[^a-z]/g, "");
  return [scope.campusSlug, scope.campusName].some((name) => plain(name) === plain(asked) || plain(scope.campusName).startsWith(plain(asked)));
}

/** Active listings that match, best word matches first and then the cheapest, as the buyer agent ranks them. */
export function searchCatalog(catalog: readonly CatalogListing[], extras: ReadonlyMap<string, ListingExtras>, scope: SearchScope, input: SearchListingsInput, roomLabel: string | null): ListingResult[] {
  const words = (input.query ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
  const maxCents = input.maxPriceDollars === undefined ? undefined : Math.round(input.maxPriceDollars * 100);
  const within = (mm: number, limit: number | undefined) => limit === undefined || mm <= limit * MM_PER_INCH;
  return catalog
    .filter((listing) => listing.sameRoom === null || (scope.room !== null && listing.sameRoom.roomPresetId === scope.room.roomPresetId && listing.sameRoom.roomNumber === scope.room.roomNumber))
    .filter((listing) => input.category === undefined || listing.category === input.category)
    .filter((listing) => maxCents === undefined || listing.priceCents <= maxCents)
    .filter((listing) => within(listing.widthMm, input.maxWidthInches) && within(listing.depthMm, input.maxDepthInches) && within(listing.heightMm, input.maxHeightInches))
    .map((listing) => {
      const text = `${listing.title} ${listing.description} ${listing.color} ${listing.styleTags.join(" ")}`.toLowerCase();
      return { listing, score: words.filter((word) => text.includes(word)).length };
    })
    .filter(({ score }) => words.length === 0 || score > 0 || input.category !== undefined)
    .sort((a, b) => b.score - a.score || a.listing.priceCents - b.listing.priceCents)
    .slice(0, input.limit ?? 12)
    .map(({ listing }) => {
      const extra = extras.get(listing.id);
      const size = [listing.widthMm, listing.depthMm, listing.heightMm] as const;
      const photo = extra?.photoSrc ?? "";
      const broken = scope.room === null ? undefined : hallRuleViolations(scope.room.constraints, listing, [])[0];
      return {
        listingId: listing.id,
        title: listing.title,
        category: listing.category,
        condition: CONDITION_LABEL[listing.condition],
        price: formatUsdShort(listing.priceCents),
        priceCents: listing.priceCents,
        seller: listing.sellerName,
        size: `${formatInches(size)} (${formatCentimeters(size)})`,
        pieces: listing.specs.pieces ?? 1,
        color: listing.color,
        styleTags: listing.styleTags,
        handoff: handoffWords(listing, extra?.handoffMode ?? "direct", roomLabel),
        photoUrl: photo.startsWith("/") ? absoluteUrl(scope.appUrl, photo) : photo,
        breaksHallRule: broken === undefined || scope.room === null ? null : `${scope.room.hallName} rule ${broken.section}: ${broken.summary}`,
      };
    });
}

export const roomPresetsInput = z.object({
  hall: z.string().max(80).optional().describe('Only rooms in this residence hall, such as "Harbor Hall".'),
});
export type RoomPresetsInput = z.infer<typeof roomPresetsInput>;

export const roomPresetSchema = z.object({
  slug: z.string(),
  name: z.string(),
  hall: z.string(),
  roomType: z.string(),
  size: z.string(),
  ceiling: z.string(),
  windows: z.number().int(),
  doors: z.number().int(),
  provided: z.array(z.string()),
  hallRules: z.array(z.object({ section: z.string(), rule: z.string() })),
  demoRoom: z.string().nullable(),
});
export type RoomPresetResult = z.infer<typeof roomPresetSchema>;
export const roomPresetsOutput = z.object({ rooms: z.array(roomPresetSchema) });
export type RoomPresetsOutput = z.infer<typeof roomPresetsOutput>;

const ROOM_TYPES = { single: "single", double: "double", apartment_bedroom: "apartment bedroom" } as const;
const meters = (mm: number) => (mm / 1000).toFixed(1);
const feet = (mm: number) => (mm / 304.8).toFixed(1);

/** "2 beds, 2 desks, 1 steam radiator", from each fixture's own label with its side of the room left out. */
function providedWords(preset: Pick<PresetWithRules, "geometry">): string[] {
  const counts = new Map<string, number>();
  for (const fixture of preset.geometry.fixtures) {
    const word = fixture.label.replace(/^(East|West|North|South) /, "").toLowerCase();
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()].map(([word, count]) => `${count} ${count === 1 ? word : `${word}s`}`);
}

/** The rooms a plan can furnish, with their size, what the university provides, and the hall's rules. */
export function roomPresets(presets: readonly PresetWithRules[], input: RoomPresetsInput, demo: { presetSlug: string; label: string; student: string }): RoomPresetResult[] {
  const hall = input.hall?.toLowerCase().trim();
  return presets
    .filter((preset) => hall === undefined || preset.hallName.toLowerCase().includes(hall))
    .map((preset) => ({
      slug: preset.slug,
      name: preset.name,
      hall: preset.hallName,
      roomType: ROOM_TYPES[preset.roomType],
      size: `${meters(preset.widthMm)} by ${meters(preset.depthMm)} m (${feet(preset.widthMm)} by ${feet(preset.depthMm)} ft)`,
      ceiling: `${meters(preset.ceilingHeightMm)} m`,
      windows: preset.geometry.windows.length,
      doors: preset.geometry.doors.length,
      provided: providedWords(preset),
      hallRules: preset.constraints.map((constraint) => ({ section: constraint.section, rule: constraint.summary })),
      demoRoom: preset.slug === demo.presetSlug ? `${demo.student} moves into ${demo.label}, a room of this kind, so plans for this preset furnish ${demo.label}.` : null,
    }));
}
