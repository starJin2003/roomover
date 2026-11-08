import type { ReactNode } from "react";

interface ScheduleSectionProps {
  description: string;
  /** The Bryntum Scheduler. Until it arrives, the section shows where it goes. */
  children?: ReactNode;
}

/** The schedule inside Handoff: when each seller moves out, when the buyer moves in, and the handoff slot. */
export function ScheduleSection({ description, children }: ScheduleSectionProps) {
  return (
    <section aria-labelledby="schedule-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 id="schedule-title" className="text-base font-semibold">
          Schedule
        </h3>
        <p className="text-sm text-flint">{description}</p>
      </div>
      {children ?? (
        <div className="flex min-h-48 items-center justify-center rounded-2xl border border-dashed border-flint p-6 text-center text-sm text-flint">
          The Bryntum Scheduler renders here in its own task
        </div>
      )}
    </section>
  );
}
