import type { AgentName } from "@/lib/domain/enums";

export interface ActivityEntry {
  readonly agent: AgentName;
  /** Who acted, such as "Buyer agent" or "Jun's seller agent". */
  readonly actor: string;
  readonly tool: string;
  readonly at: { readonly iso: string; readonly label: string };
  readonly summary: string;
  /** Structured negotiation terms, shown under the summary. */
  readonly terms?: readonly { readonly label: string; readonly value: string }[];
  /** A hard constraint stopped this step. */
  readonly blocked?: boolean;
  readonly paypal?: { readonly api: string; readonly idLabel: string; readonly id: string };
}

/** Each agent has a shape, so lines stay distinct without relying on color. */
function AgentMark({ agent }: { agent: AgentName }) {
  const shape = {
    buyer: <circle cx="7" cy="7" r="5.5" />,
    seller: <rect x="1.5" y="1.5" width="11" height="11" rx="2.5" />,
    verifier: <path d="M7 0.8L13.2 7 7 13.2 0.8 7z" />,
    platform: <path d="M7 1.2l5.6 10.4H1.4z" />,
  }[agent];
  return (
    <svg aria-hidden="true" viewBox="0 0 14 14" className="size-3.5 shrink-0 fill-ink">
      {shape}
    </svg>
  );
}

export function ActivityLine({ entry }: { entry: ActivityEntry }) {
  // Only the left edge takes a color, so the dividers between lines keep theirs.
  const rule = entry.paypal !== undefined ? "border-l-blue" : entry.blocked ? "border-l-brick" : "border-l-transparent";
  return (
    <li className={`flex flex-col gap-1.5 border-l-[3px] py-3 pr-1 pl-4 ${rule}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-2 text-sm font-semibold">
            <AgentMark agent={entry.agent} />
            {entry.actor}
          </span>
          {entry.paypal === undefined ? (
            <code className="mono rounded-sm bg-stone/15 px-1.5 text-xs leading-5">{entry.tool}</code>
          ) : (
            <span className="text-sm font-semibold text-navy">{entry.paypal.api}</span>
          )}
        </div>
        <time dateTime={entry.at.iso} className="shrink-0 pt-0.5 text-xs text-flint">
          {entry.at.label}
        </time>
      </div>
      <p className="text-sm text-pretty">
        {entry.blocked && <span className="font-semibold text-brick">Skipped. </span>}
        {entry.summary}
      </p>
      {entry.terms !== undefined && (
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {entry.terms.map((term) => (
            <div key={term.label} className="flex gap-1.5">
              <dt className="text-flint">{term.label}</dt>
              <dd className="font-semibold">{term.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {entry.paypal !== undefined && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-flint">{entry.paypal.idLabel}</span>
          <span className="mono rounded-sm bg-blue px-1.5 text-xs leading-5 font-semibold">{entry.paypal.id}</span>
          <span className="text-xs text-flint">sandbox</span>
        </p>
      )}
    </li>
  );
}
