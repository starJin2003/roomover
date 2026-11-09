import type { ReactNode } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";

interface ScheduleSectionProps {
  description: string;
  /** Folds under the room behind one press, which keeps the room large on desktop. */
  collapsible?: boolean;
  /** The Bryntum Scheduler. Until it arrives, the section shows where it goes. */
  children?: ReactNode;
}

function Placeholder() {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-2xl border border-dashed border-flint p-6 text-center text-sm text-flint">
      The Bryntum Scheduler renders here in its own task
    </div>
  );
}

/** The schedule inside Handoff: when each seller moves out, when the buyer moves in, and the handoff slot. */
export function ScheduleSection({ description, collapsible = false, children }: ScheduleSectionProps) {
  if (collapsible) {
    return (
      <details className="group shrink-0">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-md text-sm font-medium [&::-webkit-details-marker]:hidden">
          Schedule
          <ChevronDownIcon className="size-4 transition-transform duration-(--duration-quick) ease-out group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-4 pt-2">
          <p className="text-sm text-flint">{description}</p>
          {children ?? <Placeholder />}
        </div>
      </details>
    );
  }
  return (
    <section aria-labelledby="schedule-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 id="schedule-title" className="text-base font-semibold">
          Schedule
        </h3>
        <p className="text-sm text-flint">{description}</p>
      </div>
      {children ?? <Placeholder />}
    </section>
  );
}
