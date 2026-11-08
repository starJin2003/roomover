"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { PAYOUT_ITEM_STATUS_DISPLAY } from "@/lib/design/status";
import { formatUsd } from "@/lib/format";

interface MotionDemoProps {
  itemLabel: string;
  sellerName: string;
  payoutCents: number;
}

/** Plays the land and settle motions on request. Nothing here moves on its own. */
export function MotionDemo({ itemLabel, sellerName, payoutCents }: MotionDemoProps) {
  const [drops, setDrops] = useState(0);
  const [paid, setPaid] = useState(false);
  const firstName = sellerName.split(" ")[0];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-4 rounded-lg border border-stone/50 p-4">
        <p className="text-sm font-semibold">Land, 560 ms with a spring</p>
        <div className="relative flex h-28 items-end justify-center overflow-hidden border-b-2 border-stone">
          <span
            key={drops}
            className={`mb-1.5 rounded-md bg-sky px-3 py-2 text-sm font-semibold text-ink shadow-key-tall ${drops > 0 ? "animate-land" : ""}`}
          >
            {itemLabel}
          </span>
        </div>
        <Button variant="secondary" className="self-start" onClick={() => setDrops((count) => count + 1)}>
          Drop the {itemLabel.toLowerCase()}
        </Button>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-stone/50 p-4">
        <p className="text-sm font-semibold">Settle, 320 ms</p>
        <div className="flex h-28 flex-col justify-center gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-md font-semibold">{sellerName}</span>
            <span className="text-xl font-bold tabular-nums" aria-live="polite">
              {formatUsd(paid ? payoutCents : 0)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-stone/20">
            <div
              className={`h-full origin-left rounded-full bg-blue transition-transform duration-(--duration-settle) ease-out ${paid ? "scale-x-100" : "scale-x-0"}`}
            />
          </div>
          <div>
            <StatusChip status={PAYOUT_ITEM_STATUS_DISPLAY[paid ? "succeeded" : "pending"]} />
          </div>
        </div>
        <Button variant="secondary" className="self-start" onClick={() => setPaid((value) => !value)}>
          {paid ? "Reset the payout" : `Pay ${firstName}`}
        </Button>
      </div>
    </div>
  );
}
