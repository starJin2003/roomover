import { connection } from "next/server";
import { Suspense } from "react";
import { RoomStage } from "@/components/room/room-stage";
import { SiteHeader } from "@/components/site/site-header";
import { ChoiceKey } from "@/components/ui/choice-key";
import { UNIVERSITY } from "@/scripts/seed/campus";
import { activeListingCount, demoRoom } from "./screen-data";

function RoomPending() {
  return <div aria-hidden="true" className="aspect-[6/5] w-full sm:aspect-[8/7]" />;
}

async function HomeRoom() {
  await connection();
  const room = await demoRoom().catch((error: unknown) => {
    console.error("home: demo room did not load", { error: error instanceof Error ? error.name : "unknown" });
    return null;
  });
  return room === null ? <RoomPending /> : <RoomStage label={room.label} preset={room.preset} items={room.items} showList={false} />;
}

async function ListingCount() {
  await connection();
  const count = await activeListingCount().catch(() => null);
  return (
    <p className="text-base text-flint sm:text-lg">
      {count === null ? `Items from students leaving ${UNIVERSITY} this term` : `${count} items from students leaving ${UNIVERSITY} this term`}
    </p>
  );
}

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-[1360px] gap-6 px-4 pb-10 sm:px-10 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-center lg:gap-12 lg:pb-16">
        <Suspense fallback={<RoomPending />}>
          <HomeRoom />
        </Suspense>
        <div className="flex flex-col gap-8 lg:gap-10">
          <div className="flex flex-col gap-3">
            <h1 className="text-2xl font-semibold text-balance">Furnish your dorm room from students moving out</h1>
            <Suspense fallback={<p className="text-base text-flint sm:text-lg">Items from students leaving {UNIVERSITY} this term</p>}>
              <ListingCount />
            </Suspense>
          </div>
          <nav aria-label="What would you like to do" className="flex flex-col gap-4">
            <ChoiceKey href="/furnish" tone="primary" title="Furnish a room" description="Agents pick items that fit your room and budget" />
            <ChoiceKey href="/sell" title="Sell items" description="Take a photo and we fill in the price" />
          </nav>
        </div>
      </main>
    </>
  );
}
