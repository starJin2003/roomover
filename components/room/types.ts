import type { LayoutItem } from "@/lib/domain/layout";
import type { ListingColor } from "@/lib/domain/listing";
import type { RoomGeometry } from "@/lib/domain/room";

/** A room preset as stored in Postgres, with its hall's name. */
export interface RoomPresetData {
  slug: string;
  name: string;
  hallName: string;
  widthMm: number;
  depthMm: number;
  ceilingHeightMm: number;
  geometry: RoomGeometry;
}

/** One placed item with what its tag shows. */
export interface RoomItemData {
  layout: LayoutItem;
  title: string;
  condition: string;
  priceCents: number;
  sellerName: string;
  color: string;
  /** Swatches from the listing photo. The room falls back to `color` words when there are none. */
  colors: readonly ListingColor[];
}
