export interface Choice<T extends string> {
  value: T;
  title: string;
  description: string;
  /** Why this choice is not open, shown in its place. */
  disabledReason?: string | null;
}

interface ChoiceGroupProps<T extends string> {
  name: string;
  legend: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** A short list of radio rows, each with a line saying what choosing it means. */
export function ChoiceGroup<T extends string>({ name, legend, choices, value, onChange }: ChoiceGroupProps<T>) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium text-ink">{legend}</legend>
      {choices.map((choice) => {
        const disabled = choice.disabledReason !== undefined && choice.disabledReason !== null;
        return (
          <label
            key={choice.value}
            className={`flex min-h-13 items-center gap-3 rounded-lg px-3 py-2 shadow-ring transition-colors duration-(--duration-quick) has-checked:bg-well has-checked:shadow-ring-strong has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink ${disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-well"}`}
          >
            <input type="radio" name={name} value={choice.value} checked={choice.value === value} disabled={disabled} onChange={() => onChange(choice.value)} className="size-4 shrink-0 accent-ink" />
            <span className="flex min-w-0 flex-col">
              <span className={`text-sm font-medium ${disabled ? "text-flint" : ""}`}>{choice.title}</span>
              <span className="text-xs text-flint">{disabled ? choice.disabledReason : choice.description}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
