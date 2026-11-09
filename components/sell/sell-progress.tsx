import { Spinner } from "@/components/ui/spinner";

export interface ProgressStep {
  key: string;
  /** What is happening, or what happened once it is done. */
  text: string;
  state: "working" | "done" | "waiting";
}

function DoneMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0">
      <circle cx="8" cy="8" r="7" fill="var(--color-ink)" />
      <path d="M4.8 8.2l2.1 2.1 4.3-4.6" fill="none" stroke="var(--color-paper)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The two lookups behind a listing, in the order they run, each saying what it found. */
export function SellProgress({ steps }: { steps: readonly ProgressStep[] }) {
  return (
    <ol aria-live="polite" className="flex flex-col gap-3">
      {steps.map((step) => (
        <li key={step.key} data-step={step.key} data-state={step.state} className={`flex gap-3 text-base ${step.state === "waiting" ? "text-flint" : ""}`}>
          {step.state === "done" ? <DoneMark /> : step.state === "working" ? <Spinner className="mt-1 size-3.5 shrink-0" /> : <span aria-hidden="true" className="mt-1.5 size-3 shrink-0 rounded-full border border-stone" />}
          <span>{step.text}</span>
        </li>
      ))}
    </ol>
  );
}
