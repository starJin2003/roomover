import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site/site-header";
import { PanelState } from "@/components/ui/panel-state";
import { loadPlanView } from "@/lib/agents/buyer/run";
import { readConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { eventsAfter, latestRun, latestSessionPlan, loadPresetsWithRules } from "@/lib/db/plans";
import type { ActivityEventView, PlanView } from "@/lib/plan-view";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { activeListingCount, furnishPresets } from "../screen-data";
import { FurnishScreen } from "./furnish-screen";

export const metadata: Metadata = {
  title: "Furnish a room",
  description: "Tell the buyer agent your budget and how you live, and watch it furnish your dorm room with items from students moving out.",
};

function FurnishPending() {
  return (
    <div aria-hidden="true" className="mx-auto grid w-full max-w-[1360px] gap-6 px-4 sm:px-10 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-12">
      <div className="aspect-[6/5] w-full sm:aspect-[8/7]" />
      <div className="h-96 rounded-2xl bg-paper shadow-sheet max-lg:-mx-4 max-lg:rounded-b-none" />
    </div>
  );
}

/** The session's latest plan with every activity line, so a reload shows exactly what the stream showed. */
async function sessionPlan(session: string | null): Promise<{ plan: PlanView | null; events: ActivityEventView[] }> {
  if (session === null) return { plan: null, events: [] };
  const db = getDb();
  const row = await latestSessionPlan(db, session);
  if (row === null) return { plan: null, events: [] };
  const preset = (await loadPresetsWithRules(db)).find((candidate) => candidate.id === row.roomPresetId);
  if (preset === undefined) return { plan: null, events: [] };
  const [plan, events] = await Promise.all([latestRun(db, row.id).then((run) => loadPlanView(db, row, preset, run)), eventsAfter(db, row.id, 0)]);
  return { plan, events };
}

async function Furnish() {
  // Reading the cookie first marks the page as request time, before anything below can catch the bailout.
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = verifySession(cookie, readConfig(["SESSION_SECRET"]).SESSION_SECRET);
  const data = await Promise.all([furnishPresets(), activeListingCount(), sessionPlan(session)]).catch((error: unknown) => {
    console.error("furnish: page data did not load", { error: error instanceof Error ? error.name : "unknown" });
    return null;
  });
  if (data === null) {
    return (
      <main className="mx-auto w-full max-w-[440px] px-4">
        <div className="rounded-2xl bg-paper p-6 shadow-sheet">
          <PanelState kind="error" title="The room did not load" body="Room presets and listings come from Postgres, and the query failed. Reload the page to try again." />
        </div>
      </main>
    );
  }
  const [presets, listingCount, current] = data;
  return <FurnishScreen presets={presets} listingCount={listingCount} initialPlan={current.plan} initialEvents={current.events} />;
}

export default function FurnishPage() {
  return (
    <>
      <SiteHeader />
      <Suspense fallback={<FurnishPending />}>
        <Furnish />
      </Suspense>
    </>
  );
}
