import { PAYPAL_SDK_BUTTON } from "@/lib/design/paypal";
import { splitEvenly } from "@/lib/domain/money";
import { formatUsdShort } from "@/lib/format";

/**
 * Holds the place of `<paypal-button type="pay">` from the PayPal JavaScript
 * SDK v6, at the size the SDK renders it. Roomover never draws its own
 * approve button, so the checkout task mounts the real one here.
 */
export function PayPalButtonSlot() {
  return (
    <div
      className="flex w-full items-center justify-center border border-dashed border-stone px-4 text-sm font-medium"
      style={{ height: PAYPAL_SDK_BUTTON.heightPx, borderRadius: PAYPAL_SDK_BUTTON.radiusPx }}
    >
      PayPal button slot, JavaScript SDK v6
    </div>
  );
}

/** Holds the place of the official Pay Later message from the SDK's paypal-messages component. */
export function PayLaterMessageSlot({ amountCents }: { amountCents: number }) {
  const [installmentCents] = splitEvenly(amountCents, 4);
  return (
    <p
      className="flex min-h-6 w-full items-center justify-center border border-dashed border-stone px-3 py-1 text-center text-xs text-flint"
      style={{ borderRadius: PAYPAL_SDK_BUTTON.radiusPx }}
    >
      Pay Later message slot, such as Pay in 4 interest-free payments of {formatUsdShort(installmentCents)}
    </p>
  );
}
