import type { Metadata } from "next";
import Link from "next/link";
import { PRIMARY_LINK } from "@/components/furnish/paid-panel";
import { SiteHeader } from "@/components/site/site-header";
import { Panel } from "@/components/ui/panel";
import { SELL_STEPS, StepStrip } from "@/components/ui/step-strip";

export const metadata: Metadata = {
  title: "Sell items",
  description: "Turn a photo of something you are leaving behind into a listing.",
};

export default function SellPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1360px] justify-center px-4 pt-6 pb-16 sm:px-10 sm:pt-16">
        <Panel id="sell" heading="h1" title="Selling opens next" subtitle="Lakeshore students who move out list items here" className="w-full max-w-[440px]">
          <StepStrip steps={SELL_STEPS} current={0} label="Listing progress" />
          <p className="text-base">
            You will take a photo of a desk, lamp, or chair, and Roomover fills in the title, size, and a fair price. You set the lowest price
            you will take, and PayPal pays you after the next student checks the item at handoff.
          </p>
          <p className="text-sm text-flint">Log in with PayPal comes with this screen, so payouts reach the account you choose.</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/furnish" className={`${PRIMARY_LINK} flex-1`}>
              Furnish a room
            </Link>
            <Link
              href="/"
              className="inline-flex h-13 items-center justify-center rounded-lg px-6 text-base font-semibold text-ink transition-colors duration-(--duration-press) key-hover:bg-well key-focus:outline-2 key-focus:outline-offset-2 key-focus:outline-ink"
            >
              Back home
            </Link>
          </div>
        </Panel>
      </main>
    </>
  );
}
