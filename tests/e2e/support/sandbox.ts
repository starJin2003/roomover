import type { BrowserContext } from "@playwright/test";
import { readOptionalConfig } from "@/lib/config";

/**
 * The default run moves no sandbox money. The server answers PayPal calls
 * from recorded responses, the browser gets a stand-in for the JavaScript
 * SDK that approves the server's order at once, and Log in with PayPal comes
 * straight back with a stub code the recorded sandbox accepts. Setting
 * ROOMOVER_E2E_LIVE=1 runs the same tests against the real sandbox.
 */
export const LIVE = readOptionalConfig("ROOMOVER_E2E_LIVE") !== undefined;

/** Defines the three SDK elements and the calls PayPalCheckout makes, nothing more. */
const STAND_IN_SDK = `(() => {
  const key = (name, label) => {
    if (customElements.get(name)) return;
    customElements.define(name, class extends HTMLElement {
      connectedCallback() {
        if (this.shadowRoot) return;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.style.cssText = "display:block;width:100%;height:45px;border:0;border-radius:4px;background:#ffd140;color:#14151a;font:600 16px system-ui;cursor:pointer";
        this.attachShadow({ mode: "open" }).append(button);
      }
    });
  };
  key("paypal-button", "PayPal");
  key("paypal-pay-later-button", "Pay Later");
  if (!customElements.get("paypal-message")) customElements.define("paypal-message", class extends HTMLElement {});
  const session = (callbacks) => ({
    async start(_options, order) {
      try {
        const { orderId } = await order;
        await callbacks.onApprove({ orderId });
      } catch (error) {
        callbacks.onError({ message: String(error) });
      }
    },
  });
  window.paypal = {
    async createInstance() {
      return {
        async findEligibleMethods() {
          return { isEligible: () => true, getDetails: () => ({ productCode: "PAYLATER", countryCode: "US" }) };
        },
        createPayPalOneTimePaymentSession: session,
        createPayLaterOneTimePaymentSession: session,
        createPayPalMessages: () => ({}),
      };
    },
  };
})();`;

/**
 * Points a browser context at the recorded sandbox. Live runs keep the real
 * PayPal pages. Playwright does not route the hop a redirect leads to, so the
 * login stub answers Roomover's own login route: it keeps the server's state
 * cookie and sends the browser straight to the callback with that state,
 * leaving out only PayPal's page.
 */
export async function routeRecordedPayPal(context: BrowserContext, baseURL: string): Promise<void> {
  if (LIVE) return;
  await context.route("https://www.sandbox.paypal.com/web-sdk/v6/core**", (route) => route.fulfill({ contentType: "application/javascript", body: STAND_IN_SDK }));
  await context.route(`${baseURL}/api/auth/paypal/login`, async (route) => {
    const answer = await route.fetch({ maxRedirects: 0 });
    const state = new URL(answer.headers().location ?? "https://www.sandbox.paypal.com/connect").searchParams.get("state") ?? "";
    const cookie = answer.headers()["set-cookie"];
    await route.fulfill({ status: 302, headers: { location: `${baseURL}/api/auth/paypal/callback?code=stub-e2e&state=${encodeURIComponent(state)}`, ...(cookie === undefined ? {} : { "set-cookie": cookie }) } });
  });
}
