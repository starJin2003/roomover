import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { PRIMARY_LINK } from "@/components/furnish/paid-panel";
import { ScreenFrame, SHELL_COLUMNS } from "@/components/site/screen-frame";
import { Panel } from "@/components/ui/panel";
import { PanelState } from "@/components/ui/panel-state";
import { readConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { firstNameOf } from "@/lib/handoff/words";
import { loadHandoffScreen } from "@/lib/handoff/load";
import { planIdSchema } from "@/lib/http";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { HandoffScreen } from "./handoff-screen";

export const metadata: Metadata = {
  title: "Handoff",
  description: "Check each item with a photo when you pick it up. The verifier agent compares it with the seller's photos, and PayPal pays each seller their share.",
};

function HandoffPending() {
  return (
    <div aria-hidden="true" className={SHELL_COLUMNS}>
      <div className="aspect-[8/7] w-full max-lg:hidden lg:aspect-auto" />
      <div className="h-[36rem] rounded-2xl bg-paper shadow-sheet lg:h-full" />
    </div>
  );
}

function NothingToHandOff({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto flex w-full max-w-[1360px] justify-center px-4 pt-6 pb-16 sm:px-10 sm:pt-16">
      <Panel id="handoff" heading="h1" title={title} className="w-full max-w-[440px]">
        <p className="text-base">{body}</p>
        <Link href="/furnish" className={PRIMARY_LINK}>
          Go to your room
        </Link>
      </Panel>
    </main>
  );
}

async function Handoff({ params }: { params: Promise<{ planId: string }> }) {
  // Reading the cookie first marks the page as request time, before anything below can catch the bailout.
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  const { planId } = await params;
  const session = verifySession(cookie, readConfig(["SESSION_SECRET"]).SESSION_SECRET);
  if (session === null || !planIdSchema.safeParse(planId).success) {
    return <NothingToHandOff title="No handoff here" body="This handoff belongs to another browser, or it does not exist. Your own room is a tap away." />;
  }
  const data = await loadHandoffScreen(getDb(), planId, session).catch((error: unknown) => {
    console.error("handoff: page data did not load", { error: error instanceof Error ? error.name : "unknown" });
    return undefined;
  });
  if (data === undefined) {
    return (
      <main className="mx-auto w-full max-w-[440px] px-4">
        <div className="rounded-2xl bg-paper p-6 shadow-sheet">
          <PanelState kind="error" title="The handoff did not load" body="Orders and listings come from Postgres, and the query failed. Reload the page to try again." />
        </div>
      </main>
    );
  }
  if (data === null) {
    return <NothingToHandOff title="Nothing to hand off yet" body="Handoff opens once PayPal holds the payment for your room. Approve it on the Furnish screen first." />;
  }
  return (
    <HandoffScreen
      initialView={data.view}
      preset={{ slug: data.preset.slug, name: data.preset.name, hallName: data.preset.hallName, widthMm: data.preset.widthMm, depthMm: data.preset.depthMm, ceilingHeightMm: data.preset.ceilingHeightMm, geometry: data.preset.geometry }}
      roomItems={data.planView.items}
      buyerFirstName={firstNameOf(data.plan.buyerName)}
    />
  );
}

export default function HandoffPage({ params }: PageProps<"/handoff/[planId]">) {
  return (
    <ScreenFrame>
      <Suspense fallback={<HandoffPending />}>
        <Handoff params={params} />
      </Suspense>
    </ScreenFrame>
  );
}
