import { asc, eq, inArray } from "drizzle-orm";
import { listingColorsSchema, type ConditionGrade, type ListingColor } from "@/lib/domain/listing";
import { roomGeometrySchema, type RoomGeometry } from "@/lib/domain/room";
import type { Database } from "./client";
import { halls, listings, roomPresets, users } from "./schema";

export interface RoomPresetRow {
  slug: string;
  name: string;
  hallName: string;
  widthMm: number;
  depthMm: number;
  ceilingHeightMm: number;
  geometry: RoomGeometry;
}

/** Every room preset with its hall, ordered by hall name. Geometry is parsed again on the way out. */
export async function loadRoomPresets(db: Database): Promise<RoomPresetRow[]> {
  const rows = await db
    .select({
      slug: roomPresets.slug,
      name: roomPresets.name,
      hallName: halls.name,
      widthMm: roomPresets.widthMm,
      depthMm: roomPresets.depthMm,
      ceilingHeightMm: roomPresets.ceilingHeightMm,
      geometry: roomPresets.geometry,
    })
    .from(roomPresets)
    .innerJoin(halls, eq(roomPresets.hallId, halls.id))
    .orderBy(asc(halls.name));
  return rows.map((row) => ({ ...row, geometry: roomGeometrySchema.parse(row.geometry) }));
}

export interface RoomListingRow {
  id: string;
  title: string;
  color: string;
  colors: ListingColor[];
  conditionGrade: ConditionGrade;
  priceCents: number;
  sellerName: string;
}

/** What a placed item's tag shows, for the listings in a layout. */
export async function loadRoomListings(db: Database, ids: readonly string[]): Promise<RoomListingRow[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: listings.id,
      title: listings.title,
      color: listings.color,
      colors: listings.colors,
      conditionReport: listings.conditionReport,
      priceCents: listings.priceCents,
      sellerName: users.displayName,
    })
    .from(listings)
    .innerJoin(users, eq(listings.sellerId, users.id))
    .where(inArray(listings.id, [...ids]));
  return rows.map(({ conditionReport, colors, ...row }) => ({
    ...row,
    colors: colors.length === 0 ? [] : listingColorsSchema.parse(colors),
    conditionGrade: conditionReport.grade,
  }));
}
