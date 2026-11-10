import type { Metadata } from "next";
import Link from "next/link";
import { PRIMARY_LINK } from "@/components/furnish/paid-panel";
import { SiteHeader } from "@/components/site/site-header";
import { Panel } from "@/components/ui/panel";

export const metadata: Metadata = {
  title: "No page here",
  description: "Roomover has no page at this address.",
};

/** Any address Roomover does not serve, inside the same shell as every screen. */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1360px] justify-center px-4 pt-6 pb-16 sm:px-10 sm:pt-16">
        <Panel id="not-found" heading="h1" title="No room at this address" className="w-full max-w-[440px]">
          <p className="text-base">The link may be old or mistyped. Furnish Harbor Hall 214 from what students are leaving behind, or list something you are leaving yourself.</p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link href="/furnish" className={PRIMARY_LINK}>
              Furnish a room
            </Link>
            <Link href="/sell" className="-mx-2 inline-flex min-h-11 items-center rounded-md px-2 text-base font-semibold underline decoration-stone underline-offset-4">
              Sell an item
            </Link>
          </div>
        </Panel>
      </main>
    </>
  );
}
