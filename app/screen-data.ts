import { cacheLife } from "next/cache";
import type { RoomItemData, RoomPresetData } from "@/components/room/types";
import { roomLabel } from "@/lib/agents/buyer/run";
import { getDb } from "@/lib/db/client";
import { countActiveListings, loadPlanListings, loadPresetsWithRules } from "@/lib/db/plans";
import { DEMO_ROOM } from "@/lib/demo";
import { EGRESS_PATH_MM } from "@/lib/domain/egress";
import { buildPlanView } from "@/lib/plan-view";
import { CAMPUS } from "@/scripts/seed/campus";
import { HARBOR_214_DEMO_LAYOUT } from "@/scripts/seed/layouts";

/** A room the student can plan, with what the fit check needs on the client. */
export interface FurnishPreset extends RoomPresetData {
  /** Harbor Hall 214 for Jordan's room, the preset name otherwise. */
  label: string;
  description: string;
  roomNumber: string | null;
  egressPathMm: number;
}

const meters = (mm: number) => (mm / 1000).toFixed(1);

const ROOM_TYPE_WORDS = { single: "a single", double: "a double", apartment_bedroom: "an apartment bedroom" } as const;

/** The three room presets with their egress width, Jordan's room first, read from Postgres and cached for an hour. */
export async function furnishPresets(): Promise<FurnishPreset[]> {
  "use cache";
  cacheLife("hours");
  const presets = await loadPresetsWithRules(getDb());
  const ordered = [...presets].sort((a, b) => Number(b.slug === DEMO_ROOM.presetSlug) - Number(a.slug === DEMO_ROOM.presetSlug));
  return ordered.map((preset) => {
    const roomNumber = preset.slug === DEMO_ROOM.presetSlug ? DEMO_ROOM.roomNumber : null;
    const egress = preset.constraints.find((constraint) => constraint.kind === "egress_clearance");
    const size = `${meters(preset.widthMm)} by ${meters(preset.depthMm)} meters`;
    return {
      slug: preset.slug,
      name: preset.name,
      hallName: preset.hallName,
      widthMm: preset.widthMm,
      depthMm: preset.depthMm,
      ceilingHeightMm: preset.ceilingHeightMm,
      geometry: preset.geometry,
      label: roomLabel(preset, roomNumber),
      description: `${roomNumber === null ? "" : "Jordan's room, "}${ROOM_TYPE_WORDS[preset.roomType]} of ${size}`.replace(/^a/, (letter) => letter.toUpperCase()),
      roomNumber,
      egressPathMm: egress?.kind === "egress_clearance" ? egress.minPathWidthMm : EGRESS_PATH_MM,
    };
  });
}

/** Harbor Hall 214 furnished with the five seller demo cart, for the Home screen. */
export async function demoRoom(): Promise<{ label: string; preset: RoomPresetData; items: RoomItemData[] }> {
  "use cache";
  cacheLife("hours");
  const preset = (await furnishPresets()).find((candidate) => candidate.slug === DEMO_ROOM.presetSlug);
  if (preset === undefined) throw new Error(`Room preset ${DEMO_ROOM.presetSlug} is missing from the database.`);
  const ids = HARBOR_214_DEMO_LAYOUT.items.flatMap((item) => (item.source === "listing" ? [item.listingId] : []));
  const view = buildPlanView(
    { id: "demo", status: "ready", presetSlug: preset.slug, roomLabel: preset.label, budgetCents: 0, stylePrompt: "" },
    HARBOR_214_DEMO_LAYOUT,
    await loadPlanListings(getDb(), ids),
    null,
  );
  return { label: preset.label, preset, items: view.items };
}

export async function activeListingCount(): Promise<number> {
  "use cache";
  cacheLife("minutes");
  return countActiveListings(getDb(), CAMPUS);
}
