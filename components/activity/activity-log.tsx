import type { AgentName } from "@/lib/domain/enums";

export interface ActivityEntry {
  /** Unique within the log. Steps written in the same instant share a time and a tool. */
  readonly id?: string;
  readonly agent: AgentName;
  /** Who acted, such as "Buyer agent" or "Jun's seller agent". */
  readonly actor: string;
  readonly tool: string;
  readonly at: { readonly iso: string; readonly label: string };
  readonly summary: string;
  /** A hard constraint stopped this step. */
  readonly blocked?: boolean;
  readonly paypal?: { readonly api: string; readonly idLabel: string; readonly id: string };
  /** Record IDs behind the step, shown with the Developer view on. */
  readonly refs?: readonly { readonly label: string; readonly value: string }[];
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
    <svg aria-hidden="true" viewBox="0 0 14 14" className="size-3 shrink-0 fill-flint">
      {shape}
    </svg>
  );
}

/** The full agent log behind Details: time, agent, tool, and every PayPal ID. */
export function ActivityLog({ entries, showRefs = false }: { entries: readonly ActivityEntry[]; showRefs?: boolean }) {
  return (
    <ol className="flex flex-col">
      {entries.map((entry) => (
        <li key={entry.id ?? `${entry.at.iso}-${entry.tool}`} className="flex flex-col gap-1 border-t border-hair py-3 first:border-t-0 first:pt-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-flint">
            <time dateTime={entry.at.iso} className="mono">
              {entry.at.label}
            </time>
            <span className="inline-flex items-center gap-1.5 font-medium text-ink">
              <AgentMark agent={entry.agent} />
              {entry.actor}
            </span>
            <code className="mono">{entry.paypal?.api ?? entry.tool}</code>
          </p>
          <p className="text-sm text-pretty">
            {entry.blocked === true && <span className="font-medium text-brick">Skipped. </span>}
            {entry.summary}
          </p>
          {entry.paypal !== undefined && (
            <p className="text-xs text-flint">
              {entry.paypal.idLabel} <span className="mono text-ink">{entry.paypal.id}</span>, sandbox
            </p>
          )}
          {showRefs &&
            entry.refs?.map((ref) => (
              <p key={ref.label} className="text-xs break-all text-flint">
                {ref.label} <span className="mono text-ink">{ref.value}</span>
              </p>
            ))}
        </li>
      ))}
    </ol>
  );
}
