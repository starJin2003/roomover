"use client";

import { ActivityLog, type ActivityEntry } from "@/components/activity/activity-log";
import { useUnderTheHood } from "@/components/paypal/under-the-hood";
import { Details } from "@/components/ui/details";
import type { PayPalIdKind } from "@/lib/domain/agent-events";
import type { ActivityEventView } from "@/lib/plan-view";

/** How many everyday sentences the panel keeps in view. */
const SENTENCES_SHOWN = 3;

// Campus time on the server and in every browser, so the first render matches.
const timeFormat = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", second: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });

export const timeLabel = (iso: string) => `${dayFormat.format(new Date(iso))}, ${timeFormat.format(new Date(iso))}`;

const ACTORS = { buyer: "Buyer agent", seller: "Seller agent", verifier: "Verifier agent", platform: "Roomover" } as const;
const ID_LABELS: Readonly<Record<PayPalIdKind, string>> = {
  order: "Order",
  authorization: "Authorization",
  capture: "Capture",
  refund: "Refund",
  reauthorization: "Reauthorization",
  payout_batch: "Payout batch",
  payout_item: "Payout item",
  dispute: "Dispute",
  transaction: "Transaction",
};

function toEntry(event: ActivityEventView): ActivityEntry {
  const refs = [
    { label: event.agent === "platform" ? "Order record" : "Run", value: event.runId },
    ...(event.detail.listingId === undefined ? [] : [{ label: "Listing", value: event.detail.listingId }]),
    ...(event.detail.itemKey === undefined ? [] : [{ label: "Item", value: event.detail.itemKey }]),
  ];
  const note = event.detail.note === undefined ? "" : ` The agent's reason was "${event.detail.note}"`;
  return {
    id: String(event.seq),
    agent: event.agent,
    actor: event.detail.mcp === undefined ? ACTORS[event.agent] : `${ACTORS[event.agent]}, via MCP`,
    tool: event.detail.mcp?.tool ?? event.tool,
    at: { iso: event.at, label: timeLabel(event.at) },
    summary: `${event.summary}${note}`,
    blocked: event.blocked && event.tool !== "run_failed",
    paypal: event.paypal === null ? undefined : { api: event.paypal.api, idLabel: ID_LABELS[event.detail.paypalIdKind ?? "order"], id: event.paypal.id },
    refs,
  };
}

/** What the agents did, in about three sentences, with every step and its IDs one press away. */
export function ActivityFeed({ events, shown = SENTENCES_SHOWN }: { events: readonly ActivityEventView[]; shown?: number }) {
  const underTheHood = useUnderTheHood();
  const sentences = shown === 0 ? [] : events.filter((event) => event.sentence !== null).slice(-shown);
  return (
    <div className="flex flex-col gap-2">
      <ul aria-live="polite" aria-relevant="additions" className={`flex flex-col gap-3 ${sentences.length === 0 ? "hidden" : ""}`}>
        {sentences.map((event) => (
          <li key={event.seq} className="grid grid-cols-[6px_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-base">
            <span aria-hidden="true" className={`mt-[9px] size-1.5 rounded-full ${event.tool === "run_failed" ? "bg-brick" : "bg-stone"}`} />
            <span data-sentence className={event.tool === "run_failed" ? "font-medium text-brick" : undefined}>
              {event.sentence}
            </span>
            {underTheHood && (
              <span className="col-start-2 text-xs text-flint">
                <time dateTime={event.at} className="mono">
                  {timeFormat.format(new Date(event.at))}
                </time>{" "}
                <code className="mono">{event.paypal?.api ?? event.detail.mcp?.tool ?? event.tool}</code>
                {event.paypal !== null && (
                  <>
                    {" "}
                    <span className="mono text-ink">{event.paypal.id}</span>
                  </>
                )}
                {event.detail.mcp !== undefined && (
                  <span data-via-mcp className="text-ink">
                    {" "}
                    via MCP from {event.detail.mcp.client}
                  </span>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      {events.length > 0 && (
        <Details summary={`Details, ${events.length} steps`}>
          <ActivityLog entries={events.map(toEntry)} showRefs={underTheHood} />
        </Details>
      )}
    </div>
  );
}
