"use client";

import { MOTION } from "@/lib/design/tokens";
import { sellersPaidProgress } from "@/lib/design/sellers-paid";
import { formatUsdShort } from "@/lib/format";
import { useTweenedNumber } from "./use-tweened-number";

export interface SellerPayout {
  readonly payoutItemId: string;
  readonly sellerName: string;
  readonly itemTitle: string;
  readonly amountCents: number;
  /** Replaces "Payout pending" when PayPal reports something else, such as an unclaimed or failed payout. */
  readonly note?: { readonly text: string; readonly alert: boolean };
}

interface SellersPaidProps {
  payouts: readonly SellerPayout[];
  /** Payout item IDs in the order their payout events arrived. */
  paidIds: readonly string[];
}

const SETTLE_MS = MOTION.find((motion) => motion.token === "settle")?.ms ?? 320;

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

/** Each seller row fills in PayPal blue when its payout event arrives, and the total ticks up. */
export function SellersPaid({ payouts, paidIds }: SellersPaidProps) {
  const progress = sellersPaidProgress(payouts, paidIds);
  const shownCents = Math.round(useTweenedNumber(progress.paidCents, SETTLE_MS));
  const sellers = payouts.length;

  return (
    <div className="flex flex-col gap-4">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-semibold tabular-nums">{formatUsdShort(shownCents)}</span>
        <span className="text-base text-flint">
          {progress.allPaid ? `sent to ${sellers} sellers` : `sent to ${progress.paidCount} of ${sellers} sellers`}
        </span>
      </p>
      <p className="sr-only" aria-live="polite">
        {progress.paidCount} of {sellers} sellers paid
      </p>
      <ul className="flex flex-col gap-1">
        {progress.rows.map((row) => {
          const paid = row.paidOrder !== null;
          return (
            <li key={row.payoutItemId} data-paid={paid} className="relative isolate overflow-hidden rounded-lg shadow-ring">
              <span
                aria-hidden="true"
                className={`absolute inset-0 -z-10 origin-left bg-blue transition-transform duration-(--duration-settle) ease-out ${paid ? "scale-x-100" : "scale-x-0"}`}
              />
              <div className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3">
                <span
                  aria-hidden="true"
                  className={`grid size-9 place-items-center rounded-full text-xs font-medium transition-colors duration-(--duration-settle) ${paid ? "bg-paper" : "bg-well"}`}
                >
                  {initials(row.sellerName)}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">{row.sellerName}</span>
                  <span className={`truncate text-sm transition-colors duration-(--duration-settle) ${paid ? "text-ink" : "text-flint"}`}>
                    {row.itemTitle}
                  </span>
                </span>
                <span className="flex flex-col items-end">
                  <span className="text-base font-semibold tabular-nums">{formatUsdShort(row.amountCents)}</span>
                  <span className={`text-xs ${paid ? "font-medium text-ink" : row.note?.alert === true ? "font-medium text-brick" : "text-flint"}`}>
                    {paid ? "Paid with PayPal" : (row.note?.text ?? "Payout pending")}
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
