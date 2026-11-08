import type { ReactNode } from "react";
import { ActivityLine, type ActivityEntry } from "./activity-line";

interface ActivityPanelProps {
  id: string;
  title: string;
  subtitle: string;
  entries?: readonly ActivityEntry[];
  /** Replaces the log when the panel is empty, loading, or failed. */
  state?: ReactNode;
}

/** A calm live log of agent steps. PayPal steps carry a blue rule and their sandbox ID. */
export function ActivityPanel({ id, title, subtitle, entries = [], state }: ActivityPanelProps) {
  return (
    <section aria-labelledby={`${id} ${id}-subtitle`} className="flex flex-col gap-4 rounded-xl border border-stone/50 p-4 sm:p-6">
      <header className="flex flex-col gap-0.5">
        <h3 id={id} className="text-lg font-bold">
          {title}
        </h3>
        <p id={`${id}-subtitle`} className="text-sm text-flint">
          {subtitle}
        </p>
      </header>
      {state ?? (
        <ol className="flex flex-col divide-y divide-stone/30">
          {entries.map((entry) => (
            <ActivityLine key={`${entry.at.iso}-${entry.tool}`} entry={entry} />
          ))}
        </ol>
      )}
    </section>
  );
}
