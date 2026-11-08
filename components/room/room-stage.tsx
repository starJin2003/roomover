/** The empty table area the React Three Fiber room fills in the 3D task. */
export function RoomStage({ room }: { room: string }) {
  return (
    <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-3xl border border-dashed border-flint p-6 text-center lg:aspect-auto lg:min-h-[560px]">
      <p className="text-sm font-medium">3D room, {room}</p>
      <p className="text-sm text-flint">The 3D task renders the room on this table</p>
    </div>
  );
}
