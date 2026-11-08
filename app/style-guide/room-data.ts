import { cacheLife } from "next/cache";
import type { RoomItemData, RoomPresetData } from "@/components/room/types";
import { getDb } from "@/lib/db/client";
import { loadRoomListings, loadRoomPresets, type RoomPresetRow } from "@/lib/db/rooms";
import type { PlanLayout } from "@/lib/domain/layout";
import { CONDITION_LABEL } from "@/lib/format";
import { DEMO_PRESET_SLUG, HARBOR_214_DEMO_LAYOUT, TEST_LAYOUTS } from "@/scripts/seed/layouts";
import { CART_PRICE_CENTS } from "./demo-data";

export interface RoomData {
  preset: RoomPresetData;
  items: RoomItemData[];
}

/** Joins a layout to the listing rows its tags show. Listings missing from the database fail loudly. */
async function roomData(preset: RoomPresetRow, layout: PlanLayout, prices?: ReadonlyMap<string, number>): Promise<RoomData> {
  const ids = layout.items.flatMap((item) => (item.source === "listing" ? [item.listingId] : []));
  const rows = new Map((await loadRoomListings(getDb(), ids)).map((row) => [row.id, row]));
  const items = layout.items.map((item): RoomItemData => {
    if (item.source !== "listing") throw new Error(`Layout item ${item.key} is not a listing.`);
    const row = rows.get(item.listingId);
    if (row === undefined) throw new Error(`Listing ${item.key} is missing from the database.`);
    return {
      layout: item,
      title: row.title,
      condition: CONDITION_LABEL[row.conditionGrade],
      priceCents: prices?.get(row.id) ?? row.priceCents,
      sellerName: row.sellerName,
      color: row.color,
    };
  });
  return { preset, items };
}

function presetBySlug(presets: RoomPresetRow[], slug: string): RoomPresetRow {
  const preset = presets.find((candidate) => candidate.slug === slug);
  if (preset === undefined) throw new Error(`Room preset ${slug} is missing from the database.`);
  return preset;
}

/** Harbor Hall 214 with Jordan's five seller cart, read from Postgres and cached for an hour. */
export async function furnishRoom(): Promise<RoomData> {
  "use cache";
  cacheLife("hours");
  const presets = await loadRoomPresets(getDb());
  return roomData(presetBySlug(presets, DEMO_PRESET_SLUG), HARBOR_214_DEMO_LAYOUT, CART_PRICE_CENTS);
}

/** All three presets with the test layouts that place every seed listing. */
export async function presetRooms(): Promise<RoomData[]> {
  "use cache";
  cacheLife("hours");
  const presets = await loadRoomPresets(getDb());
  return Promise.all(
    Object.entries(TEST_LAYOUTS).map(([slug, layout]) => roomData(presetBySlug(presets, slug), layout)),
  );
}
