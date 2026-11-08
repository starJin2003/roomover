"use client";

import { useEffect, useRef, useState } from "react";
import { SellersPaid, type SellerPayout } from "@/components/payouts/sellers-paid";
import { Button } from "@/components/ui/button";

const EVENT_GAP_MS = 600;

/** Shows the finished list, and replays the payout events one by one on request. */
export function SellersPaidDemo({ payouts, arrivals }: { payouts: readonly SellerPayout[]; arrivals: readonly string[] }) {
  const [paidIds, setPaidIds] = useState<readonly string[]>(arrivals);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  function replay() {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    setPaidIds([]);
    timers.current = arrivals.map((id, index) =>
      window.setTimeout(() => setPaidIds((current) => [...current, id]), EVENT_GAP_MS * (index + 1)),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SellersPaid payouts={payouts} paidIds={paidIds} />
      <Button variant="secondary" size="sm" className="self-start" onClick={replay}>
        Replay payout events
      </Button>
    </div>
  );
}
