import Link from "next/link";
import { PayPalCard, type PayPalReference } from "@/components/paypal/paypal-card";
import { formatUsdShort } from "@/lib/format";
import type { CheckoutView } from "@/lib/plan-view";

export const PRIMARY_LINK =
  "inline-flex h-13 items-center justify-center rounded-lg bg-key px-6 pb-1 text-base font-semibold text-paper shadow-key-ink transition-[translate,box-shadow] duration-(--duration-press) ease-out key-hover:-translate-y-px key-press:translate-y-0.5 key-press:shadow-key-ink-down key-focus:outline-2 key-focus:outline-offset-2 key-focus:outline-ink";

/** The panel after the student approves. It says where the money is and leads on to handoff. */
export function PaidPanel({ planId, checkout }: { planId: string; checkout: CheckoutView }) {
  const total = formatUsdShort(checkout.totalCents);
  const students = checkout.sellerCount === 1 ? "1 student gets" : `${checkout.sellerCount} students get`;
  const references: PayPalReference[] = [
    ...(checkout.paypalOrderId === null ? [] : [{ api: "Orders v2", label: "Order", id: checkout.paypalOrderId }]),
    ...(checkout.authorizationId === null ? [] : [{ api: "Orders v2", label: "Authorization", id: checkout.authorizationId }]),
    ...(checkout.captureId === null ? [] : [{ api: "Orders v2", label: "Capture", id: checkout.captureId }]),
  ];

  if (checkout.status === "capture_pending") {
    return (
      <p role="status" className="text-base">
        PayPal is still processing your {total} payment. Reload this page in a minute to see it clear.
      </p>
    );
  }

  if (checkout.status === "settled" || checkout.status === "settling") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-base">{checkout.status === "settled" ? "You checked every item, and PayPal paid the sellers." : "PayPal is settling your handoff now."}</p>
        <Link href={`/handoff/${planId}`} className={PRIMARY_LINK}>
          {checkout.status === "settled" ? "See the handoff" : "Go to handoff"}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {checkout.status === "authorized" ? (
        <PayPalCard
          moment="held"
          title={`PayPal holds your ${total} until handoff`}
          detail={`Each item is charged when you check it at handoff, and ${students} paid then.`}
          references={references}
        />
      ) : (
        <PayPalCard
          moment="captured"
          title={`PayPal captured ${total}`}
          detail={`Roomover holds it until you check each item at handoff, and refunds anything you turn down.`}
          references={references}
        />
      )}
      <Link href={`/handoff/${planId}`} className={PRIMARY_LINK}>
        Go to handoff
      </Link>
    </div>
  );
}
