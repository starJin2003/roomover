"use client";

import { useState } from "react";
import { RoomStage } from "@/components/room/room-stage";
import type { RoomData } from "./room-data";

/** One room at a time, so the page holds a single WebGL canvas. */
export function PresetSwitcher({ rooms }: { rooms: RoomData[] }) {
  const [slug, setSlug] = useState(rooms[0]?.preset.slug);
  const room = rooms.find((candidate) => candidate.preset.slug === slug) ?? rooms[0];
  if (room === undefined) return null;
  return (
    <div className="flex flex-col gap-6">
      <div role="group" aria-label="Room preset" className="flex flex-wrap gap-2">
        {rooms.map(({ preset, items }) => (
          <button
            key={preset.slug}
            type="button"
            aria-pressed={preset.slug === room.preset.slug}
            onClick={() => setSlug(preset.slug)}
            className="inline-flex min-h-11 flex-col items-start justify-center rounded-lg bg-paper px-4 py-2 text-left shadow-key-paper transition-[translate,box-shadow] duration-(--duration-press) ease-out aria-pressed:bg-key aria-pressed:text-paper aria-pressed:shadow-key-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <span className="text-sm font-semibold">{preset.name}</span>
            <span className="text-xs">
              {(preset.widthMm / 1000).toFixed(2)} by {(preset.depthMm / 1000).toFixed(2)} m, {items.length} listings
            </span>
          </button>
        ))}
      </div>
      <RoomStage key={room.preset.slug} label={room.preset.name} preset={room.preset} items={room.items} />
    </div>
  );
}
