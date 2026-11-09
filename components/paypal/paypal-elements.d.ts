import type { DetailedHTMLProps, HTMLAttributes } from "react";

type Element<Props> = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & Props;

// The custom elements the PayPal JavaScript SDK v6 defines, with the attributes they observe.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "paypal-button": Element<{ type?: "pay" | "checkout" | "buynow"; disabled?: boolean }>;
      "paypal-pay-later-button": Element<{ productcode?: string; countrycode?: string; disabled?: boolean }>;
    }
  }
}
