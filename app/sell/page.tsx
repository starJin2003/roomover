import type { Metadata } from "next";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { ScreenFrame, SHELL_COLUMNS } from "@/components/site/screen-frame";
import { PanelState } from "@/components/ui/panel-state";
import { readConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { loadSeller } from "@/lib/db/sellers";
import { SELLER_COOKIE, verifySeller } from "@/lib/seller-session";
import { currentSellView } from "@/lib/sell/http";
import { LOGIN_SENTENCE, loginOutcome } from "@/lib/sell/login";
import type { SellView } from "@/lib/sell/view";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { SellScreen } from "./sell-screen";

export const metadata: Metadata = {
  title: "Sell an item",
  description: "Log in with PayPal and take one photo. Claude reads the item, Channel3 finds its size and new price, and the seller agent suggests a fair used price.",
};

function SellPending() {
  return (
    <ScreenFrame person={null}>
      <div aria-hidden="true" className={SHELL_COLUMNS}>
        <div className="aspect-[4/5] w-full rounded-2xl bg-paper shadow-sheet sm:aspect-[4/3] lg:aspect-auto" />
        <div className="h-96 rounded-2xl bg-paper shadow-sheet max-lg:-mx-4 max-lg:rounded-b-none lg:h-full" />
      </div>
    </ScreenFrame>
  );
}

/** The seller signed in on this browser, and the Sell view for them, or null before Log in with PayPal. */
async function sellerView(store: Awaited<ReturnType<typeof cookies>>): Promise<SellView | null> {
  const { SESSION_SECRET } = readConfig(["SESSION_SECRET"]);
  const sessionId = verifySession(store.get(SESSION_COOKIE)?.value, SESSION_SECRET);
  const sellerId = verifySeller(store.get(SELLER_COOKIE)?.value, SESSION_SECRET, new Date());
  if (sessionId === null || sellerId === null) return null;
  const db = getDb();
  const seller = await loadSeller(db, sellerId);
  return seller === null ? null : currentSellView({ db, seller, sessionId, now: () => new Date() });
}

async function Sell({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Reading the cookies first marks the page as request time, before the catch below could swallow that, and the clock needs a live request.
  const store = await cookies();
  await connection();
  const view = await sellerView(store).catch((error: unknown) => {
    console.error("sell: page data did not load", { error: error instanceof Error ? error.name : "unknown" });
    return undefined;
  });
  if (view === undefined) {
    return (
      <ScreenFrame person={null}>
        <main className="mx-auto w-full max-w-[440px] px-4">
          <div className="rounded-2xl bg-paper p-6 shadow-sheet">
            <PanelState kind="error" title="Sell did not load" body="Your listing comes from Postgres, and the query failed. Reload the page to try again." />
          </div>
        </main>
      </ScreenFrame>
    );
  }
  const login = (await searchParams).login;
  const outcome = view === null ? loginOutcome(typeof login === "string" ? login : undefined) : null;
  return (
    <ScreenFrame person={view?.seller.name ?? null}>
      <SellScreen initialView={view} loginNote={outcome === null ? null : LOGIN_SENTENCE[outcome]} />
    </ScreenFrame>
  );
}

export default function SellPage({ searchParams }: PageProps<"/sell">) {
  return (
    <Suspense fallback={<SellPending />}>
      <Sell searchParams={searchParams} />
    </Suspense>
  );
}
