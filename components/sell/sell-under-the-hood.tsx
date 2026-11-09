"use client";

import { useUnderTheHood } from "@/components/paypal/under-the-hood";
import { formatUsdShort } from "@/lib/format";
import type { SellDraftView } from "@/lib/sell/view";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const count = new Intl.NumberFormat("en-US");

function Line({ who, call, children, paypal = false }: { who: string; call: string; children: React.ReactNode; paypal?: boolean }) {
  return (
    <li className={`flex flex-col gap-1 border-t border-hair py-3 first:border-t-0 first:pt-0 ${paypal ? "border-l-[3px] border-l-blue pl-3" : ""}`}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-flint">
        <span className="font-medium text-ink">{who}</span>
        <code className="mono">{call}</code>
      </p>
      <div className="text-sm text-pretty">{children}</div>
    </li>
  );
}

/**
 * What ran behind the listing, shown while Under the hood is on: the Channel3
 * search with its match, the seller agent's Claude call, and where payouts
 * go: the payer ID, showing only its last four characters, or the email.
 */
export function SellUnderTheHood({ draft, payerIdLast4 }: { draft: SellDraftView | null; payerIdLast4: string | null }) {
  const on = useUnderTheHood();
  if (!on) return null;
  return (
    <section aria-label="Under the hood" className="rounded-xl bg-well p-4">
      <ol className="flex flex-col">
        {draft !== null && (
          <Line who="Channel3" call="identify_product_by_image, POST /v1/image-search">
            {draft.channel3.unavailable !== null ? (
              <p>No answer. {draft.channel3.unavailable}</p>
            ) : (
              <p>
                Kept {draft.channel3.candidateCount} {draft.channel3.candidateCount === 1 ? "product" : "products"} with a new US price,{" "}
                {draft.channel3.cached ? "answered from the cache for this photo, 0 credits" : `${draft.channel3.credits} credit${draft.channel3.credits === 1 ? "" : "s"}, ${seconds(draft.channel3.latencyMs)}`}.
              </p>
            )}
            {draft.match !== null && (
              <p className="mt-1 text-flint">
                Match: <span className="text-ink">{draft.match.title}</span>, {formatUsdShort(draft.match.newPriceCents)} at {draft.match.domain}, product <span className="mono text-ink">{draft.match.productId}</span>
              </p>
            )}
            {draft.match === null && draft.details !== null && <p className="mt-1 text-flint">The seller agent found no candidate that is the same product.</p>}
          </Line>
        )}
        {draft !== null && draft.claude.mode !== null && (
          <Line who="Seller agent" call={`${draft.claude.model ?? "claude-sonnet-5-5"}, describe_listing`}>
            <p>
              {draft.claude.mode === "live"
                ? `${draft.claude.calls} Claude ${draft.claude.calls === 1 ? "call" : "calls"}, ${count.format(draft.claude.inputTokens)} tokens in, ${count.format(draft.claude.outputTokens)} out`
                : "Replayed from a recorded Claude reply"}
              {draft.claude.describeMs === null ? "." : `, ${seconds(draft.claude.describeMs)}.`}
            </p>
          </Line>
        )}
        <Line who="Log in with PayPal" call="/v1/identity/oauth2/userinfo" paypal>
          {payerIdLast4 === null ? (
            <p>PayPal&apos;s answer named no payer ID, so payouts go to the account&apos;s email as recipient type EMAIL.</p>
          ) : (
            <p>
              Payer ID ending <span className="mono">{payerIdLast4}</span>. Payouts go to it as recipient type PAYPAL_ID.
            </p>
          )}
        </Line>
      </ol>
    </section>
  );
}
