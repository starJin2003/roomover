import type { ReactNode } from "react";
import { Spinner } from "./spinner";

type PanelStateKind = "empty" | "loading" | "error";

interface PanelStateProps {
  kind: PanelStateKind;
  title: string;
  body: string;
  action?: ReactNode;
}

function Mark({ kind }: { kind: PanelStateKind }) {
  if (kind === "loading") return <Spinner className="size-5 text-ink" />;
  if (kind === "error") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 text-brick">
        <circle cx="10" cy="10" r="9" fill="currentColor" />
        <rect x="9" y="4.5" width="2" height="7" rx="1" fill="var(--color-paper)" />
        <circle cx="10" cy="14.6" r="1.3" fill="var(--color-paper)" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 text-stone">
      <rect x="2" y="2" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2.4" />
    </svg>
  );
}

const LIVE_REGION: Record<PanelStateKind, "status" | "alert" | undefined> = {
  empty: undefined,
  loading: "status",
  error: "alert",
};

/** The body of a panel that has nothing to show yet, is waiting, or failed. */
export function PanelState({ kind, title, body, action }: PanelStateProps) {
  return (
    <div role={LIVE_REGION[kind]} className="flex flex-col items-start gap-3 py-2">
      <Mark kind={kind} />
      <div className="flex flex-col gap-1">
        <p className="text-md font-semibold">{title}</p>
        <p className="max-w-prose text-sm text-flint">{body}</p>
      </div>
      {kind === "loading" && (
        <div aria-hidden="true" className="flex w-full flex-col gap-2 pt-1">
          <span className="h-3 w-4/5 rounded-full bg-stone/20" />
          <span className="h-3 w-3/5 rounded-full bg-stone/20" />
        </div>
      )}
      {action !== undefined && <div className="pt-1">{action}</div>}
    </div>
  );
}
