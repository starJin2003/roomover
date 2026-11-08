interface SwitchProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** An on and off control with its label inside the 44 px target. */
export function Switch({ label, checked, onCheckedChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className="inline-flex min-h-11 items-center gap-3 rounded-lg text-sm font-medium text-ink key-focus:outline-2 key-focus:outline-offset-2 key-focus:outline-ink"
    >
      {label}
      <span
        aria-hidden="true"
        className={`relative h-6 w-10 shrink-0 rounded-full transition-colors duration-(--duration-quick) ease-out ${checked ? "bg-navy" : "bg-well shadow-ring-strong"}`}
      >
        <span
          className={`absolute top-1 left-1 size-4 rounded-full shadow-knob transition-[translate,background-color] duration-(--duration-quick) ease-out ${checked ? "translate-x-4 bg-paper" : "bg-flint"}`}
        />
      </span>
    </button>
  );
}
