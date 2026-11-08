import { connection } from "next/server";
import type { ReactNode } from "react";
import { RoomStage } from "@/components/room/room-stage";
import { PanelState } from "@/components/ui/panel-state";
import { furnishRoom, presetRooms, type RoomData } from "./room-data";
import { PresetSwitcher } from "./preset-switcher";

/** Holds the room's space while the presets load, so nothing below it moves. */
export function RoomPending() {
  return <div aria-hidden="true" className="aspect-[6/5] w-full sm:aspect-[8/7]" />;
}

async function load<T>(read: () => Promise<T>, render: (data: T) => ReactNode): Promise<ReactNode> {
  await connection();
  let data: T;
  try {
    data = await read();
  } catch (error) {
    console.error("style guide: room presets did not load", { error: error instanceof Error ? error.name : "unknown" });
    return (
      <div className="rounded-2xl bg-paper p-5 shadow-sheet">
        <PanelState kind="error" title="The room did not load" body="Room presets and listings come from Postgres, and the query failed. Reload the page to try again." />
      </div>
    );
  }
  return render(data);
}

export async function FurnishRoom({ label }: { label: string }) {
  return load(furnishRoom, (room: RoomData) => <RoomStage label={label} preset={room.preset} items={room.items} playable ring />);
}

export async function PresetRooms() {
  return load(presetRooms, (rooms: RoomData[]) => <PresetSwitcher rooms={rooms} />);
}
