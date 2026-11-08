import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "destructive";
export type ButtonSize = "md" | "sm";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** md is 52 px for the one primary action, sm is 44 px for everything else. */
  size?: ButtonSize;
  /** A square key that holds only an icon. Give it an aria-label. */
  square?: boolean;
  /** Shows a spinner and this label, and stops further presses. */
  loadingLabel?: string;
}

const SHAPE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap select-none transition-[translate,box-shadow,background-color,color] duration-(--duration-press) ease-out key-focus:outline-2 key-focus:outline-offset-2 key-focus:outline-ink";

const SIZE: Record<ButtonSize, string> = { md: "h-13 text-base", sm: "h-11 text-sm" };
const PADDING: Record<ButtonSize, string> = { md: "px-6", sm: "px-4" };
const SQUARE: Record<ButtonSize, string> = { md: "w-13", sm: "w-11" };

// Keys stand on a skirt. The label sits 4 px high so it centers on the top face.
const ON_SKIRT = "pb-1";

// A key rises a pixel under the pointer and travels down two when pressed, while its skirt shrinks.
const TRAVEL = "key-hover:-translate-y-px key-press:translate-y-0.5";

const READY: Record<ButtonVariant, string> = {
  primary: `${ON_SKIRT} bg-key text-paper shadow-key-ink key-press:shadow-key-ink-down ${TRAVEL}`,
  secondary: `${ON_SKIRT} bg-paper text-ink shadow-key-paper key-press:shadow-key-paper-down ${TRAVEL}`,
  destructive: `${ON_SKIRT} bg-brick text-paper shadow-key-brick key-press:shadow-key-brick-down ${TRAVEL}`,
  quiet: "text-ink key-hover:bg-well key-press:bg-skirt/50",
};

const BUSY: Record<ButtonVariant, string> = {
  primary: `${ON_SKIRT} bg-key text-paper shadow-key-ink cursor-progress`,
  secondary: `${ON_SKIRT} bg-paper text-ink shadow-key-paper cursor-progress`,
  destructive: `${ON_SKIRT} bg-brick text-paper shadow-key-brick cursor-progress`,
  quiet: "text-ink cursor-progress",
};

// A disabled key loses its skirt, so it reads as flat and out of reach.
const DISABLED: Record<ButtonVariant, string> = {
  primary: "bg-well text-flint cursor-not-allowed",
  secondary: "bg-well text-flint cursor-not-allowed",
  destructive: "bg-well text-flint cursor-not-allowed",
  quiet: "text-flint cursor-not-allowed",
};

export function Button({
  variant = "primary",
  size = "md",
  square = false,
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
      className={`${SHAPE} ${SIZE[size]} ${square ? SQUARE[size] : PADDING[size]} ${state[variant]} ${className}`}
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
