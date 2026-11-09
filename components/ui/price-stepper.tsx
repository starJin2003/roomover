"use client";

import { useState, type ReactNode } from "react";
import { formatUsdShort } from "@/lib/format";
import { Button } from "./button";
import { MinusIcon, PlusIcon } from "./icons";

interface PriceStepperProps {
  id: string;
  label: string;
  /** The lowest price, such as the seller's floor. The minus key stops here. */
  minCents: number;
  /** The highest price. The plus key stops here. */
  maxCents?: number;
  stepCents?: number;
  /** Sits beside the price, such as the new price for comparison. */
  aside?: ReactNode;
  /** Submits the price in cents under this name. */
  name?: string;
  /** With onChange, the parent holds the price, such as a floor that follows the asking price. */
  value?: number;
  onChange?: (cents: number) => void;
  defaultCents?: number;
}

export function PriceStepper({ id, label, minCents, maxCents = Number.POSITIVE_INFINITY, stepCents = 100, aside, name, value, onChange, defaultCents }: PriceStepperProps) {
  const [own, setOwn] = useState(defaultCents ?? minCents);
  const cents = value ?? own;
  const set = (next: number) => {
    if (value === undefined) setOwn(next);
    onChange?.(next);
  };
  const step = formatUsdShort(stepCents);
  return (
    <div role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-2">
      <span id={`${id}-label`} className="text-sm text-flint">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-4">
          <Button variant="secondary" size="sm" square aria-label={`Lower the price by ${step}`} disabled={cents - stepCents < minCents} onClick={() => set(cents - stepCents)}>
            <MinusIcon />
          </Button>
          <output id={id} aria-live="polite" className="min-w-24 text-center text-2xl font-semibold tabular-nums">
            {formatUsdShort(cents)}
          </output>
          <Button variant="secondary" size="sm" square aria-label={`Raise the price by ${step}`} disabled={cents + stepCents > maxCents} onClick={() => set(cents + stepCents)}>
            <PlusIcon />
          </Button>
        </div>
        {aside !== undefined && <span className="text-sm text-flint">{aside}</span>}
      </div>
      {name !== undefined && <input type="hidden" name={name} value={cents} />}
    </div>
  );
}
