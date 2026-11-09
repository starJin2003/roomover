/**
 * The PayPal JavaScript SDK v6, loaded in the browser only and always from
 * the sandbox. The types cover the calls Roomover makes, as read from the
 * v6 reference and the loaded SDK (6.72.0).
 */

const SDK_URL = "https://www.sandbox.paypal.com/web-sdk/v6/core";

export interface PayLaterDetails {
  productCode?: string;
  countryCode?: string;
}

export interface EligibleMethods {
  isEligible(method: "paypal" | "paylater"): boolean;
  getDetails(method: "paylater"): PayLaterDetails;
}

export interface SessionCallbacks {
  onApprove(data: { orderId: string }): Promise<void>;
  onCancel(data: { orderId?: string }): void;
  onError(error: { message?: string; code?: string }): void;
}

export interface PaymentSession {
  /** Pass the order promise without awaiting it, so the popup opens inside the click. */
  start(options: { presentationMode: "auto" }, order: Promise<{ orderId: string }>): Promise<void>;
}

export interface SdkInstance {
  findEligibleMethods(options: { currencyCode: string }): Promise<EligibleMethods>;
  createPayPalOneTimePaymentSession(callbacks: SessionCallbacks): PaymentSession;
  createPayLaterOneTimePaymentSession(callbacks: SessionCallbacks): PaymentSession;
  /** Renders every paypal-message element with auto-bootstrap that is on the page. */
  createPayPalMessages(): unknown;
}

interface PayPalNamespace {
  createInstance(options: { clientId: string; components: string[]; pageType: "checkout" }): Promise<SdkInstance>;
}

let loading: Promise<SdkInstance> | null = null;

function loadScript(): Promise<PayPalNamespace> {
  const existing = (window as { paypal?: PayPalNamespace }).paypal;
  if (existing !== undefined) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => {
      const namespace = (window as { paypal?: PayPalNamespace }).paypal;
      if (namespace === undefined) reject(new Error("The PayPal SDK loaded without its namespace."));
      else resolve(namespace);
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("The PayPal SDK did not load."));
    };
    document.head.append(script);
  });
}

/** One SDK instance per page, with the payments and messages components. A failed load can be tried again. */
export function loadPayPal(clientId: string): Promise<SdkInstance> {
  loading ??= loadScript()
    .then((paypal) => paypal.createInstance({ clientId, components: ["paypal-payments", "paypal-messages"], pageType: "checkout" }))
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}
