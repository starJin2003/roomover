import type { ReactNode } from "react";
import { ChevronDownIcon } from "./icons";

/** Everything a student does not need to finish the job, one press away. */
export function Details({ summary = "Details", children }: { summary?: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-md text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
        {summary}
        <ChevronDownIcon className="size-4 transition-transform duration-(--duration-quick) ease-out group-open:rotate-180" />
      </summary>
      <div className="pt-2">{children}</div>
    </details>
  );
}
