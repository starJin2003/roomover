import type { Metadata } from "next";
import { Suspense } from "react";
import { PresetRooms, RoomPending } from "../room-section";

export const metadata: Metadata = {
  title: "Roomover room presets",
  description: "The three room presets with every seed listing placed by the fit check.",
  robots: { index: false, follow: false },
};

export default function RoomPresetsPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-16 sm:px-10">
      <header className="flex flex-col gap-6 pt-6">
        <div className="flex items-center justify-between gap-4">
          <span className="text-lg font-semibold">Roomover</span>
          <span className="text-sm text-flint">Draft for approval</span>
        </div>
        <div className="flex max-w-3xl flex-col gap-4 pt-6 sm:pt-12">
          <h1 className="text-2xl font-semibold sm:text-3xl">Room presets</h1>
          <p className="text-base text-flint sm:text-lg">
            Lakeshore University&apos;s three rooms at their measured sizes, with all 24 seed listings spread across them. Every layout passes
            the fit check, and the university&apos;s own furniture stays in muted neutrals.
          </p>
        </div>
      </header>
      <main className="py-12 sm:py-16">
        <Suspense fallback={<RoomPending />}>
          <PresetRooms />
        </Suspense>
      </main>
    </div>
  );
}
