import type { ReactNode } from "react";

interface PanelProps {
  id: string;
  title: string;
  subtitle?: string;
  /** Sits at the right of the header, such as the Under the hood switch. */
  action?: ReactNode;
  heading?: "h2" | "h3";
  className?: string;
  children: ReactNode;
}

/** The Paper sheet that sits beside the room on every screen. */
export function Panel({ id, title, subtitle, action, heading: Heading = "h3", className = "", children }: PanelProps) {
  return (
    <section aria-labelledby={`${id}-title`} className={`flex flex-col gap-6 rounded-2xl bg-paper p-6 shadow-sheet sm:p-8 ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1">
          <Heading id={`${id}-title`} className="text-lg font-semibold sm:text-xl">
            {title}
          </Heading>
          {subtitle !== undefined && <p className="text-sm text-flint">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
