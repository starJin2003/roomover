import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

interface FieldText {
  id: string;
  label: string;
  help?: string;
  error?: string;
}

const CONTROL =
  "w-full rounded-lg border border-stone bg-paper text-base text-ink placeholder:text-flint transition-[border-color,box-shadow] duration-(--duration-quick) ease-out key-hover:border-ink key-focus:border-ink key-focus:outline-2 key-focus:outline-offset-2 key-focus:outline-ink aria-invalid:border-brick aria-invalid:shadow-[inset_0_0_0_1px_var(--color-brick)] disabled:cursor-not-allowed disabled:border-stone/50 disabled:text-flint";

function describedBy({ id, help, error }: FieldText): string | undefined {
  const ids = [help === undefined ? undefined : `${id}-help`, error === undefined ? undefined : `${id}-error`];
  return ids.filter(Boolean).join(" ") || undefined;
}

function ErrorMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <rect x="7.1" y="3.6" width="1.8" height="5.6" rx="0.9" fill="var(--color-paper)" />
      <circle cx="8" cy="11.6" r="1.1" fill="var(--color-paper)" />
    </svg>
  );
}

function FieldFrame({ field, children }: { field: FieldText; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={field.id} className="text-sm font-medium text-ink">
        {field.label}
      </label>
      {children}
      {field.help !== undefined && (
        <p id={`${field.id}-help`} className="text-sm text-flint">
          {field.help}
        </p>
      )}
      {field.error !== undefined && (
        <p id={`${field.id}-error`} className="flex gap-2 text-sm font-medium text-brick">
          <ErrorMark />
          {field.error}
        </p>
      )}
    </div>
  );
}

const controlAria = (field: FieldText) => ({
  id: field.id,
  "aria-describedby": describedBy(field),
  "aria-invalid": field.error === undefined ? undefined : true,
});

type TextFieldProps = FieldText & Omit<InputHTMLAttributes<HTMLInputElement>, "id">;

export function TextField({ id, label, help, error, className = "", ...rest }: TextFieldProps) {
  const field = { id, label, help, error };
  return (
    <FieldFrame field={field}>
      <input type="text" className={`${CONTROL} h-12 px-4 ${className}`} {...controlAria(field)} {...rest} />
    </FieldFrame>
  );
}

/** Dollars typed as a decimal. The form converts to integer cents before it leaves the browser. */
export function CurrencyField({ id, label, help, error, className = "", ...rest }: TextFieldProps) {
  const field = { id, label, help, error };
  return (
    <FieldFrame field={field}>
      <div className="relative">
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-flint">
          $
        </span>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className={`${CONTROL} h-12 pr-16 pl-8 ${className}`}
          {...controlAria(field)}
          {...rest}
        />
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-flint">
          USD
        </span>
      </div>
    </FieldFrame>
  );
}

type SelectFieldProps = FieldText &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & {
    options: readonly { value: string; label: string }[];
    placeholder?: string;
  };

export function SelectField({ id, label, help, error, options, placeholder, className = "", ...rest }: SelectFieldProps) {
  const field = { id, label, help, error };
  return (
    <FieldFrame field={field}>
      <div className="relative">
        <select className={`${CONTROL} h-12 appearance-none pr-11 pl-4 ${className}`} {...controlAria(field)} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-ink"
        >
          <path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </FieldFrame>
  );
}

type TextAreaFieldProps = FieldText & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id">;

export function TextAreaField({ id, label, help, error, className = "", ...rest }: TextAreaFieldProps) {
  const field = { id, label, help, error };
  return (
    <FieldFrame field={field}>
      <textarea className={`${CONTROL} min-h-28 resize-y px-4 py-3 ${className}`} {...controlAria(field)} {...rest} />
    </FieldFrame>
  );
}
