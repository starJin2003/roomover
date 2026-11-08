import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "destructive";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Shows a spinner and this label, and stops further presses. */
  loadingLabel?: string;
}

const SHAPE =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-md text-base font-semibold whitespace-nowrap select-none transition-[translate,box-shadow,background-color,border-color,color] duration-(--duration-press) ease-out key-focus:outline-2 key-focus:outline-offset-2 key-focus:outline-ink";

// A pressable key rises a pixel under the pointer and travels down two when pressed.
const KEY_TRAVEL =
  "key-hover:-translate-y-px key-hover:shadow-key-raised active:translate-y-0.5 active:shadow-key-pressed";

const READY: Record<ButtonVariant, string> = {
  primary: `px-5 bg-ink text-paper shadow-key ${KEY_TRAVEL}`,
  secondary: `px-5 border border-stone bg-paper text-ink shadow-key key-hover:border-ink ${KEY_TRAVEL}`,
  quiet: "px-3 text-ink key-hover:bg-stone/15 active:bg-stone/25",
  destructive: `px-5 bg-brick text-paper shadow-key ${KEY_TRAVEL}`,
};

const BUSY: Record<ButtonVariant, string> = {
  primary: "px-5 bg-ink text-paper shadow-key cursor-progress",
  secondary: "px-5 border border-stone bg-paper text-ink shadow-key cursor-progress",
  quiet: "px-3 text-ink cursor-progress",
  destructive: "px-5 bg-brick text-paper shadow-key cursor-progress",
};

// Disabled keys lose their edge, so they read as flat and out of reach.
const DISABLED: Record<ButtonVariant, string> = {
  primary: "px-5 bg-stone/25 text-flint cursor-not-allowed",
  secondary: "px-5 border border-stone/50 bg-paper text-flint cursor-not-allowed",
  quiet: "px-3 text-flint cursor-not-allowed",
  destructive: "px-5 bg-stone/25 text-flint cursor-not-allowed",
};

export function Button({
  variant = "primary",
  loadingLabel,
  disabled = false,
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const busy = loadingLabel !== undefined;
  const state = busy ? BUSY : disabled ? DISABLED : READY;
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`${SHAPE} ${state[variant]} ${className}`}
      {...rest}
    >
      {busy ? (
        <>
          <Spinner />
          {loadingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
