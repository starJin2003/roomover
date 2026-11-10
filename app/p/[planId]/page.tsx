import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PRIMARY_LINK } from "@/components/furnish/paid-panel";
import { ScreenFrame, SHELL_COLUMNS } from "@/components/site/screen-frame";
import { Panel } from "@/components/ui/panel";
import { PanelState } from "@/components/ui/panel-state";
import { readConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { planIdSchema } from "@/lib/http";
import { loadPreview, previewNotice } from "@/lib/preview";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { furnishPresets } from "../../screen-data";
import { PreviewScreen } from "./preview-screen";

export const metadata: Metadata = {
  title: "Your planned room",
  description: "A room an AI assistant furnished for you on Roomover with used items from students moving out. Look it over and approve it in PayPal.",
};

function PreviewPending() {
  return (
    <div aria-hidden="true" className={SHELL_COLUMNS}>
      <div className="aspect-[6/5] w-full sm:aspect-[8/7] lg:aspect-auto" />
      <div className="h-96 rounded-2xl bg-paper shadow-sheet max-lg:-mx-4 max-lg:rounded-b-none lg:h-full" />
    </div>
  );
}

function NoPreview() {
  return (
    <main className="mx-auto flex w-full max-w-[1360px] justify-center px-4 pt-6 pb-16 sm:px-10 sm:pt-16">
      <Panel id="preview" heading="h1" title="No room at this link" className="w-full max-w-[440px]">
        <p className="text-base">This preview link names no room an assistant planned. Ask the assistant for the link again, or plan a room yourself.</p>
        <Link href="/furnish" className={PRIMARY_LINK}>
          Plan a room
        </Link>
      </Panel>
    </main>
  );
}

async function Preview({ params, searchParams }: { params: Promise<{ planId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // The link is open to anyone who holds it, so no cookie marks the page as request time. This does.
  await connection();
  const { planId } = await params;
  const query = await searchParams;
  if (!planIdSchema.safeParse(planId).success) return <NoPreview />;
  const data = await Promise.all([loadPreview(getDb(), planId), furnishPresets()]).catch((error: unknown) => {
    console.error("preview: page data did not load", { error: error instanceof Error ? error.name : "unknown" });
    return undefined;
  });
  if (data === undefined) {
    return (
      <main className="mx-auto w-full max-w-[440px] px-4">
        <div className="rounded-2xl bg-paper p-6 shadow-sheet">
          <PanelState kind="error" title="The room did not load" body="Plans and listings come from Postgres, and the query failed. Reload the page to try again." />
        </div>
      </main>
    );
  }
  const [preview, presets] = data;
  const preset = presets.find((candidate) => candidate.slug === preview?.plan.presetSlug);
  if (preview === null || preset === undefined) return <NoPreview />;
  const code = typeof query.paypal === "string" ? query.paypal : undefined;
  const { PAYPAL_CLIENT_ID, SESSION_SECRET } = readConfig(["PAYPAL_CLIENT_ID", "SESSION_SECRET"]);
  const viewer = verifySession((await cookies()).get(SESSION_COOKIE)?.value, SESSION_SECRET);
  return (
    <PreviewScreen
      paypalClientId={PAYPAL_CLIENT_ID}
      holder={!preview.claimed ? "open" : viewer !== null && viewer === preview.ownerSessionId ? "this_browser" : "another_browser"}
      preset={preset}
      initialPlan={preview.plan}
      initialEvents={preview.events}
      assistant={preview.assistant}
      buyerFirstName={preview.buyerFirstName}
      notice={previewNotice(code)}
    />
  );
}

export default function PreviewPage({ params, searchParams }: PageProps<"/p/[planId]">) {
  return (
    <ScreenFrame>
      <Suspense fallback={<PreviewPending />}>
        <Preview params={params} searchParams={searchParams} />
      </Suspense>
    </ScreenFrame>
  );
}
