import type { ReactNode } from "react";

interface PanelProps {
  id: string;
  title: string;
  subtitle?: string;
  /** Sits at the right of the header, such as the Under the hood switch. */
  action?: ReactNode;
  heading?: "h1" | "h2" | "h3";
  /** Below the large breakpoint the panel becomes a bottom sheet under the room, full width with a grab bar. */
  sheet?: boolean;
  /** Stays under the header while the body scrolls, such as the step strip. */
  top?: ReactNode;
  /** The screen's primary action, pinned under the body on desktop. */
  footer?: ReactNode;
  footerClassName?: string;
  /**
   * On desktop the panel takes the height its column gives it, the body
   * scrolls inside, and the footer stays in view, so the page never grows.
   */
  shell?: boolean;
  className?: string;
  children: ReactNode;
}

const SHEET = "max-lg:-mx-4 max-lg:rounded-b-none max-lg:rounded-t-3xl";
const INSET = "px-6 sm:px-8";

/** The Paper sheet that sits beside the room on every screen. */
export function Panel({ id, title, subtitle, action, heading: Heading = "h3", sheet = false, top, footer, footerClassName = "", shell = false, className = "", children }: PanelProps) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-panel={id}
      className={`flex flex-col rounded-2xl bg-paper shadow-sheet ${sheet ? SHEET : ""} ${shell ? "lg:h-full lg:min-h-0" : ""} ${className}`}
    >
      <div className={`flex flex-col gap-6 ${INSET} ${sheet ? "max-lg:px-5 max-lg:pt-3" : ""} pt-6 sm:pt-8 ${shell ? "lg:pb-5" : ""}`}>
        {sheet && <span aria-hidden="true" className="mx-auto -mb-2 h-1 w-10 rounded-full bg-skirt lg:hidden" />}
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex flex-col gap-1">
            <Heading id={`${id}-title`} className="text-lg font-semibold sm:text-xl">
              {title}
            </Heading>
            {subtitle !== undefined && <p className="text-sm text-flint">{subtitle}</p>}
          </div>
          {action}
        </header>
        {top}
      </div>
      <div
        data-panel-body
        // A scrolling body takes focus, so the keyboard can scroll it even when it holds no control.
        tabIndex={shell ? 0 : undefined}
        className={`flex flex-col gap-6 ${INSET} ${sheet ? "max-lg:px-5" : ""} pt-6 ${footer === undefined ? "pb-6 sm:pb-8" : "pb-6"} ${shell ? "lg:relative lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:border-t lg:border-hair lg:pt-5" : ""}`}
      >
        {children}
      </div>
      {footer !== undefined && (
        <div data-panel-footer className={`flex flex-col gap-3 ${INSET} ${sheet ? "max-lg:px-5" : ""} pt-4 pb-6 sm:pb-8 ${shell ? "lg:border-t lg:border-hair" : ""} ${footerClassName}`}>
          {footer}
        </div>
      )}
    </section>
  );
}
