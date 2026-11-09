import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PRIMARY_LINK } from "@/components/furnish/paid-panel";
import { SiteHeader } from "@/components/site/site-header";
import { Panel } from "@/components/ui/panel";
import { BUYER_STEPS, StepStrip } from "@/components/ui/step-strip";
import { readConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { latestHandoffPlanId } from "@/lib/db/handoffs";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Handoff",
  description: "Check each item when you pick it up, and PayPal pays the students who sold them.",
};

/** Sends the browser to its latest paid room, or says how to get one. */
async function LatestHandoff() {
  const session = verifySession((await cookies()).get(SESSION_COOKIE)?.value, readConfig(["SESSION_SECRET"]).SESSION_SECRET);
  const planId = session === null ? null : await latestHandoffPlanId(getDb(), session);
  if (planId !== null) redirect(`/handoff/${planId}`);
  return (
    <main className="mx-auto flex w-full max-w-[1360px] justify-center px-4 pt-6 pb-16 sm:px-10 sm:pt-16">
      <Panel id="handoff" heading="h1" title="Handoff opens after you pay" subtitle="Where you pick up each item and check it" className="w-full max-w-[440px]">
        <StepStrip steps={BUYER_STEPS} current={2} label="Furnish progress" />
        <p className="text-base">
          When you pick up an item, you take a photo of it here. The verifier agent compares your photo with the seller&apos;s, and every student who sold
          you a matching item gets paid through PayPal.
        </p>
        <Link href="/furnish" className={PRIMARY_LINK}>
          Go to your room
        </Link>
      </Panel>
    </main>
  );
}

export default function HandoffPage() {
  return (
    <>
      <SiteHeader />
      <Suspense>
        <LatestHandoff />
      </Suspense>
    </>
  );
}
