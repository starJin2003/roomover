import { Details } from "@/components/ui/details";
import { ActivityLog, type ActivityEntry } from "./activity-log";

interface ActivitySummaryProps {
  /** About three short sentences a student understands. */
  sentences: readonly string[];
  log: readonly ActivityEntry[];
}

/** What the agents did, in words, with the full log one press away. */
export function ActivitySummary({ sentences, log }: ActivitySummaryProps) {
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-3">
        {sentences.map((sentence) => (
          <li key={sentence} className="grid grid-cols-[6px_minmax(0,1fr)] gap-3 text-base">
            <span aria-hidden="true" className="mt-[9px] size-1.5 rounded-full bg-stone" />
            {sentence}
          </li>
        ))}
      </ul>
      <Details>
        <ActivityLog entries={log} />
      </Details>
    </div>
  );
}
