import Image from "next/image";
import { monogramLayout, PAYPAL_MONOGRAM } from "@/lib/design/paypal";

/**
 * The official full color PayPal monogram on the white ground PayPal requires,
 * with its clear space as padding. The text beside it names PayPal, so the
 * image itself is decorative.
 */
export function PayPalMark({ heightPx = 24 }: { heightPx?: number }) {
  const layout = monogramLayout(heightPx);
  return (
    <span className="inline-flex shrink-0 rounded-sm bg-paypal-ground" style={{ padding: layout.clearSpacePx }}>
      <Image
        src={PAYPAL_MONOGRAM.src}
        alt=""
        width={layout.widthPx}
        height={layout.heightPx}
        style={{ width: layout.widthPx, height: layout.heightPx }}
      />
    </span>
  );
}
