export const BUYER_STEPS = ["Plan", "Pay", "Handoff", "Sellers paid"] as const;
export const SELL_STEPS = ["Photo", "Details", "Listed"] as const;

interface StepStripProps {
  steps: readonly string[];
  /** Index of the current step. Only this one is emphasized. */
  current: number;
  label: string;
}

/** Where the person is in the flow, in words. */
export function StepStrip({ steps, current, label }: StepStripProps) {
  return (
    <ol aria-label={label} className="flex flex-wrap gap-1">
      {steps.map((step, index) => (
        <li
          key={step}
          aria-current={index === current ? "step" : undefined}
          className={
            index === current
              ? "rounded-md bg-well px-3 py-1.5 text-sm font-medium text-ink shadow-ring"
              : "px-3 py-1.5 text-sm text-flint"
          }
        >
          {step}
        </li>
      ))}
    </ol>
  );
}
