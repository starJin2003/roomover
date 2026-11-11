"use client";

import { PayPalMark } from "./paypal-mark";
import { useUnderTheHood } from "./under-the-hood";

/** The three moments money moves. The card appears at these and nowhere else. */
export type PayPalMoment = "held" | "captured" | "paid";

export interface PayPalReference {
  /** The PayPal API that produced the ID, such as PayPal Payments v2. */
  readonly api: string;
  readonly label: string;
  readonly id: string;
}

interface PayPalCardProps {
  moment: PayPalMoment;
  title: string;
  detail?: string;
  /** Shown only while the Developer view is on. */
  references: readonly PayPalReference[];
}

export function PayPalCard({ moment, title, detail, references }: PayPalCardProps) {
  const underTheHood = useUnderTheHood();
  return (
    <div data-paypal-moment={moment} className="flex flex-col gap-3 rounded-xl bg-navy p-4 text-paper">
      <div className="flex items-center gap-4">
        <PayPalMark />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-base font-semibold">{title}</p>
          {detail !== undefined && <p className="text-sm">{detail}</p>}
        </div>
      </div>
      {underTheHood && (
        <dl className="flex flex-col gap-1 border-t border-paper/20 pt-3 text-xs">
          {references.map((reference) => (
            <div key={reference.id} className="flex flex-wrap gap-x-2">
              <dt className="font-medium">{reference.api}</dt>
              <dd>
                {reference.label} <span className="mono">{reference.id}</span>, sandbox
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
