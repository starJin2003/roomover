import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PAYPAL_MOMENTS, SELLER_PAYOUTS } from "@/app/style-guide/demo-data";
import { PayPalCard } from "@/components/paypal/paypal-card";
import { PayLaterMessageSlot, PayPalButtonSlot } from "@/components/paypal/sdk-slots";
import { UnderTheHoodProvider, UnderTheHoodSwitch } from "@/components/paypal/under-the-hood";
import { SellersPaid } from "@/components/payouts/sellers-paid";

const held = PAYPAL_MOMENTS.heldAfterApproval;

describe("Under the hood", () => {
  it("is off by default, so the card shows everyday words and no PayPal IDs", () => {
    const html = renderToStaticMarkup(
      <UnderTheHoodProvider>
        <UnderTheHoodSwitch />
        <PayPalCard {...held} />
      </UnderTheHoodProvider>,
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain("PayPal is holding $141");
    for (const reference of held.references) {
      expect(html).not.toContain(reference.id);
      expect(html).not.toContain(reference.api);
    }
  });

  it("when on, reveals the API name and sandbox ID under every PayPal step", () => {
    const html = renderToStaticMarkup(
      <UnderTheHoodProvider defaultOn>
        <UnderTheHoodSwitch />
        <PayPalCard {...held} />
        <PayPalCard {...PAYPAL_MOMENTS.paid} />
      </UnderTheHoodProvider>,
    );
    expect(html).toContain('aria-checked="true"');
    for (const reference of [...held.references, ...PAYPAL_MOMENTS.paid.references]) {
      expect(html).toContain(reference.api);
      expect(html).toContain(reference.id);
    }
    expect(html).toContain("7XJ4TQ2HW9N3E");
  });

  it("shows no IDs on a card outside any provider", () => {
    expect(renderToStaticMarkup(<PayPalCard {...PAYPAL_MOMENTS.captured} />)).not.toContain("2GG279541U471931P");
  });
});

describe("PayPal card", () => {
  it("carries the official monogram with its clear space on a white ground", () => {
    const html = renderToStaticMarkup(<PayPalCard {...held} />);
    expect(html).toContain("bg-navy");
    expect(html).toContain("bg-paypal-ground");
    expect(html).toContain("padding:10px");
    expect(html).toContain("paypal-monogram.png");
  });
});

describe("SDK slots", () => {
  it("holds the button at the v6 size and quotes the Pay in 4 installment", () => {
    expect(renderToStaticMarkup(<PayPalButtonSlot />)).toContain("height:45px");
    expect(renderToStaticMarkup(<PayLaterMessageSlot amountCents={14_100} />)).toContain("Pay in 4 interest-free payments of $35.25");
  });
});

describe("Sellers paid list", () => {
  it("labels paid rows Paid with PayPal and shows the paid total", () => {
    const paidIds = [SELLER_PAYOUTS[2].payoutItemId, SELLER_PAYOUTS[0].payoutItemId];
    const html = renderToStaticMarkup(<SellersPaid payouts={SELLER_PAYOUTS} paidIds={paidIds} />);
    expect(html.match(/Paid with PayPal/g)).toHaveLength(2);
    expect(html.match(/Payout pending/g)).toHaveLength(3);
    expect(html.match(/data-paid="true"/g)).toHaveLength(2);
    expect(html).toContain("$82");
    expect(html).toContain("sent to 2 of 5 sellers");
  });

  it("reads as finished once every payout event has arrived", () => {
    const html = renderToStaticMarkup(<SellersPaid payouts={SELLER_PAYOUTS} paidIds={SELLER_PAYOUTS.map((row) => row.payoutItemId)} />);
    expect(html).toContain("$136");
    expect(html).toContain("sent to 5 sellers");
    expect(html).not.toContain("Payout pending");
  });
});
