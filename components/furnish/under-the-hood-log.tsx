"use client";

import { useUnderTheHood } from "@/components/paypal/under-the-hood";
import { formatUsdShort } from "@/lib/format";
import type { ActivityEventView, NegotiationRoundView, NegotiationView } from "@/lib/plan-view";

const firstName = (name: string) => name.split(" ")[0];

function roundLine(round: NegotiationRoundView, seller: string): string {
  const who = round.from === "buyer" ? "Buyer agent" : `${seller}'s agent`;
  const price = round.priceCents === null ? "" : ` ${formatUsdShort(round.priceCents)}`;
  const slot = round.slot === null ? "" : ` for ${round.slot}`;
  switch (round.action) {
    case "offer":
      return `${who} offered${price}${slot}.`;
    case "counter":
      return `${who} countered at${price}${slot}.`;
    case "accept":
      return `${who} accepted${price}.`;
    case "decline":
      return `${who} declined.`;
  }
}

function outcome(negotiation: NegotiationView): string {
  const asking = formatUsdShort(negotiation.askingCents);
  if (negotiation.status === "agreed" && negotiation.agreedCents !== null) return `Agreed ${formatUsdShort(negotiation.agreedCents)} of ${asking}${negotiation.slot === null ? "" : `, ${negotiation.slot}`}`;
  if (negotiation.status === "canceled") return `Canceled when the item left the plan, so ${asking} stands`;
  if (negotiation.status === "open") return `Still open, asking ${asking}`;
  return `No deal, the asking ${asking} stands`;
}

const seconds = (ms: number | undefined) => (ms === undefined ? "" : `, ${(ms / 1000).toFixed(1)} s`);

/**
 * What the Developer view adds to the Furnish panel: every offer and counter
 * between the buyer agent and the seller agents, with any answer code
 * changed, and every Channel3 search with its filters, results, and credits.
 */
export function UnderTheHoodLog({ negotiations, events }: { negotiations: readonly NegotiationView[]; events: readonly ActivityEventView[] }) {
  const on = useUnderTheHood();
  const searches = events.filter((event) => event.detail.channel3 !== undefined);
  if (!on || (negotiations.length === 0 && searches.length === 0)) return null;
  const credits = searches.reduce((sum, event) => sum + (event.detail.channel3?.credits ?? 0), 0);
  const sellerCalls = events.filter((event) => event.agent === "seller").reduce((sum, event) => sum + (event.detail.claudeCalls ?? 0), 0);
  return (
    <div className="flex flex-col gap-5" data-under-the-hood-log>
      {negotiations.length > 0 && (
        <section aria-labelledby="negotiations-heading" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="negotiations-heading" className="text-sm font-semibold">
              Negotiations
            </h2>
            <p className="text-xs text-flint tabular-nums">
              {sellerCalls} seller agent {sellerCalls === 1 ? "call" : "calls"}, claude-sonnet-5-5
            </p>
          </div>
          <ul className="flex flex-col gap-4">
            {negotiations.map((negotiation) => {
              const seller = firstName(negotiation.sellerName);
              return (
                <li key={negotiation.listingIds.join(",")} data-negotiation className="flex flex-col gap-1.5">
                  <p className="text-sm font-medium">
                    {seller}, {negotiation.titles.join(" and ").toLowerCase()}
                  </p>
                  <p className="text-xs text-flint">{outcome(negotiation)}</p>
                  <ol className="flex flex-col gap-1.5 border-l border-hair pl-3">
                    {negotiation.rounds.map((round, index) => (
                      <li key={index} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2 text-xs">
                        <span className="text-flint tabular-nums">{index === 0 || negotiation.rounds[index - 1].round !== round.round ? `Round ${round.round}` : ""}</span>
                        <span>
                          {roundLine(round, seller)}
                          {round.from === "seller" && round.message.length > 0 && <span className="block text-flint">&ldquo;{round.message}&rdquo;</span>}
                          {round.heldByCode !== null && <span className="block text-flint">Code: {round.heldByCode}</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {searches.length > 0 && (
        <section aria-labelledby="channel3-heading" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="channel3-heading" className="text-sm font-semibold">
              Channel3
            </h2>
            <p className="text-xs text-flint tabular-nums">
              {credits} {credits === 1 ? "credit" : "credits"} this plan
            </p>
          </div>
          <ul className="flex flex-col gap-4">
            {searches.map((event) => {
              const search = event.detail.channel3;
              if (search === undefined) return null;
              const gap = event.tool === "search_new_products";
              return (
                <li key={event.seq} data-channel3-search className="flex flex-col gap-1.5">
                  <p className="text-sm font-medium">{gap ? `Search for “${search.query}”, ${search.filters}` : "New prices for the used items"}</p>
                  <p className="text-xs text-flint tabular-nums">
                    <code className="mono">{gap ? "search_new_products" : "products.search"}</code>, {search.productCount} {gap ? `products, ${search.products.length} fit` : "compared"}, {search.credits}{" "}
                    {search.credits === 1 ? "credit" : "credits"}
                    {search.cached ? ", from the cache" : ""}
                    {seconds(event.detail.latencyMs)}
                  </p>
                  {search.products.length > 0 && (
                    <ul className="flex flex-col gap-1 border-l border-hair pl-3">
                      {search.products.map((product, index) => (
                        <li key={index} className="flex items-baseline justify-between gap-3 text-xs">
                          <span className="min-w-0 break-words">
                            {product.title} <span className="text-flint">at {product.retailer}</span>
                          </span>
                          <span className="shrink-0 tabular-nums">{formatUsdShort(product.priceCents)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
