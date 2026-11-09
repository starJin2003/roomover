import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaidPanel } from "@/components/furnish/paid-panel";
import { UnderTheHoodProvider } from "@/components/paypal/under-the-hood";
import type { CheckoutView } from "@/lib/plan-view";

const authorized: CheckoutView = {
  status: "authorized",
  paymentMode: "authorize_then_capture",
  totalCents: 14_100,
  sellerCount: 5,
  paypalOrderId: "6VY26189SJ770603W",
  authorizationId: "94R599622M802332T",
  captureId: null,
};

const render = (checkout: CheckoutView, underTheHood = false) =>
  renderToStaticMarkup(
    <UnderTheHoodProvider defaultOn={underTheHood}>
      <PaidPanel checkout={checkout} />
    </UnderTheHoodProvider>,
  );

describe("PaidPanel", () => {
  it("says PayPal holds the money until handoff and leads to Handoff", () => {
    const html = render(authorized);
    expect(html).toContain('data-paypal-moment="held"');
    expect(html).toContain("PayPal holds your $141 until handoff");
    expect(html).toContain("5 students get paid then.");
    expect(html).toContain('href="/handoff"');
    expect(html).not.toContain("94R599622M802332T");
  });

  it("names Orders v2, the order ID, and the authorization ID under the hood", () => {
    const html = render(authorized, true);
    expect(html).toContain("Orders v2");
    expect(html).toContain("6VY26189SJ770603W");
    expect(html).toContain("94R599622M802332T");
  });

  it("says PayPal captured the money in capture mode, with the capture ID", () => {
    const html = render({ ...authorized, status: "captured", paymentMode: "capture_at_checkout", authorizationId: null, captureId: "2GG279541U471931P" }, true);
    expect(html).toContain('data-paypal-moment="captured"');
    expect(html).toContain("PayPal captured $141");
    expect(html).toContain("2GG279541U471931P");
  });

  it("says a pending capture is still processing without the card", () => {
    const html = render({ ...authorized, status: "capture_pending", paymentMode: "capture_at_checkout", authorizationId: null });
    expect(html).toContain("PayPal is still processing your $141 payment.");
    expect(html).not.toContain("data-paypal-moment");
  });
});
