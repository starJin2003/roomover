import { readConfig, readOptionalConfig } from "@/lib/config";

type Environment = Readonly<Record<string, string | undefined>>;

/** Roomover talks to the PayPal sandbox only. There is no production switch. */
export const PAYPAL_SANDBOX = {
  apiBaseUrl: "https://api-m.sandbox.paypal.com",
  webBaseUrl: "https://www.sandbox.paypal.com",
} as const;

const LOGIN_WITH_PAYPAL_CALLBACK_PATH = "/api/auth/paypal/callback";

export interface PayPalCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export function readPayPalCredentials(env: Environment = process.env): PayPalCredentials {
  const config = readConfig(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"], env);
  return { clientId: config.PAYPAL_CLIENT_ID, clientSecret: config.PAYPAL_CLIENT_SECRET };
}

/** The webhook is registered after the first deploy, so the ID is optional at boot. */
export function readPayPalWebhookId(env: Environment = process.env): string | undefined {
  return readOptionalConfig("PAYPAL_WEBHOOK_ID", env);
}

/**
 * The redirect URI must match a return URL registered on the sandbox app
 * exactly. The dashboard rejects localhost, so local development runs on
 * http://127.0.0.1:3000.
 */
export function readLoginWithPayPalRedirectUri(env: Environment = process.env): string {
  const { APP_URL } = readConfig(["APP_URL"], env);
  return new URL(LOGIN_WITH_PAYPAL_CALLBACK_PATH, APP_URL).toString();
}
