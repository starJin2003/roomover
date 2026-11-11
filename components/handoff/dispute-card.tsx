"use client";

import { timeLabel } from "@/components/furnish/activity-feed";
import { useUnderTheHood } from "@/components/paypal/under-the-hood";
import type { HandoffView } from "@/lib/handoff/view";
import type { ActivityEventView } from "@/lib/plan-view";

/** PayPal's sandbox Resolution Center, where a buyer opens and follows a dispute. */
export const RESOLUTION_CENTER_URL = "https://www.sandbox.paypal.com/resolutioncenter";

type DisputeView = HandoffView["disputes"][number];

/** The quiet line under a finished handoff. Disputes belong to PayPal, so it points there and nowhere else. */
export function DisputeHelp() {
  return (
    <p data-dispute-help className="text-sm text-flint">
      Problem with an item? Disputes open in{" "}
      <a href={RESOLUTION_CENTER_URL} target="_blank" rel="noreferrer" className="font-medium text-ink underline decoration-stone underline-offset-2 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
        PayPal&apos;s Resolution Center<span className="sr-only">, opens in a new tab</span>
      </a>
      , and Roomover answers with the photos and the handoff record.
    </p>
  );
}

/**
 * One dispute in plain words, outlined in Brick because it needs the
 * student's eye but moves no money here. A message Roomover sent the buyer
 * in the inquiry stage shows in full. The Developer view adds the PayPal dispute
 * ID, each Agent Toolkit read, the message call, and the evidence Roomover
 * sent.
 */
export function DisputeCard({ dispute, events }: { dispute: DisputeView; events: readonly ActivityEventView[] }) {
  const underTheHood = useUnderTheHood();
  // Each dispute run shares one run ID, so its order and transaction reads come with the dispute read.
  const runs = new Set(events.filter((event) => event.paypal?.id === dispute.paypalDisputeId).map((event) => event.runId));
  const reads = events.filter((event) => event.detail.toolkit !== undefined && runs.has(event.runId));
  const submissions = events.filter((event) => event.tool === "provide_evidence" && event.paypal?.id === dispute.paypalDisputeId);
  const messages = events.filter((event) => event.tool === "send_message" && event.paypal?.id === dispute.paypalDisputeId);
  return (
    <section
      data-dispute={dispute.paypalDisputeId}
      data-dispute-status={dispute.status}
      aria-label="PayPal dispute"
      className="flex flex-col gap-3 rounded-xl bg-paper p-4 shadow-[inset_0_0_0_1.5px_var(--color-brick)]"
    >
      <div className="grid grid-cols-[10px_minmax(0,1fr)] gap-x-3 gap-y-1">
        <span aria-hidden="true" className="mt-[7px] size-2.5 rounded-full bg-brick" />
        <p className="text-base font-semibold text-pretty">{dispute.title}</p>
        <p className="col-start-2 text-sm text-pretty">{dispute.detail}</p>
      </div>
      {dispute.message !== null && (
        <figure data-dispute-message aria-label="Message Roomover sent in PayPal" className="ml-[22px]">
          <blockquote className="border-l-2 border-stone pl-3 text-sm whitespace-pre-line text-pretty">{dispute.message.text}</blockquote>
        </figure>
      )}
      {underTheHood && (
        <dl data-dispute-details className="flex flex-col gap-1.5 border-t border-hair pt-3 text-xs">
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium">Disputes API</dt>
            <dd>
              Dispute <span className="mono">{dispute.paypalDisputeId}</span>, {dispute.reason ?? "no reason yet"}
              {dispute.stage === null ? "" : `, ${dispute.stage}`}, sandbox
            </dd>
          </div>
          {reads.map((event) => (
            <div key={event.seq} data-toolkit-read className="flex flex-wrap gap-x-2">
              <dt className="font-medium">Agent Toolkit call</dt>
              <dd>
                <code className="mono">{event.detail.toolkit?.tool}</code> <span className="mono">{event.paypal?.id}</span>
                {event.detail.toolkit?.ok === false ? ", failed" : ""}
                {event.detail.toolkit?.source === "recorded" ? ", recorded" : ""}, {timeLabel(event.at)}
              </dd>
            </div>
          ))}
          {messages.map((event) => (
            <div key={event.seq} data-message-call className="flex flex-wrap gap-x-2">
              <dt className="font-medium">Disputes API send-message</dt>
              <dd>
                {event.blocked ? "did not go out" : `${dispute.message?.text.length ?? 0} characters to the buyer`}, {timeLabel(event.at)}
              </dd>
            </div>
          ))}
          {submissions.map((event) => (
            <div key={event.seq} data-evidence-submission className="flex flex-wrap gap-x-2">
              <dt className="font-medium">Disputes API provide-evidence</dt>
              <dd>
                {event.blocked
                  ? "did not go out"
                  : `${event.detail.evidence?.evidenceType ?? "evidence"}, ${event.detail.evidence?.files ?? 0} files`}
                , {timeLabel(event.at)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
