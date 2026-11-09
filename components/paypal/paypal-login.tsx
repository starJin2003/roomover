import { PRIMARY_LINK } from "@/components/furnish/paid-panel";
import { PayPalMark } from "./paypal-mark";

/**
 * Sends the seller to Log in with PayPal. A plain link, because the round
 * trip is a full page redirect to PayPal and back to the callback route.
 */
export function PayPalLoginKey() {
  return (
    <a href="/api/auth/paypal/login" className={`${PRIMARY_LINK} w-full gap-3`}>
      <PayPalMark heightPx={18} />
      Log in with PayPal
    </a>
  );
}
