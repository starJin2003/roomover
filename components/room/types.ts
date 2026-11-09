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
  /** What the student pays: the agreed price when the agents settled on one. */
  priceCents: number;
  /** The asking price, shown struck through when the agreed price is lower. */
  listPriceCents?: number;
  /** The seller's name for a used item, or the retailer for a new one. */
  sellerName: string;
  color: string;
  /** Swatches from the listing photo. The room falls back to `color` words when there are none. */
  colors: readonly ListingColor[];
  /** Set on a new item from Channel3, which the student buys from the retailer, outside the PayPal order. */
  newFrom?: { retailer: string; buyUrl: string };
  /** The handoff slot the agents agreed on. */
  slotLabel?: string;
}
