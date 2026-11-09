import type { Metadata } from "next";
import Link from "next/link";
import { PRIMARY_LINK } from "@/components/furnish/paid-panel";
import { SiteHeader } from "@/components/site/site-header";
import { Panel } from "@/components/ui/panel";
import { BUYER_STEPS, StepStrip } from "@/components/ui/step-strip";

export const metadata: Metadata = {
  title: "Handoff",
  description: "Check each item when you pick it up, and PayPal pays the students who sold them.",
};

export default function HandoffPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1360px] justify-center px-4 pt-6 pb-16 sm:px-10 sm:pt-16">
        <Panel id="handoff" heading="h1" title="Handoff opens next" subtitle="Where you pick up each item and check it" className="w-full max-w-[440px]">
          <StepStrip steps={BUYER_STEPS} current={2} label="Furnish progress" />
          <p className="text-base">
            When you pick up an item, you take a photo of it here. The verifier agent compares your photo with the seller&apos;s, and every
            student who sold you a matching item gets paid through PayPal.
          </p>
          <p className="text-sm text-flint">Your payment stays with PayPal until then, and your room stays as you left it.</p>
          <Link href="/furnish" className={PRIMARY_LINK}>
            Back to your room
          </Link>
        </Panel>
      </main>
    </>
  );
}
