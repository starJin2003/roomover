import { z } from "zod";
import { PAYPAL_SANDBOX } from "@/lib/paypal/config";
import type { PayPalRestClient } from "@/lib/paypal/rest/client";

/**
 * Log in with PayPal (OpenID Connect). The app has full name, email, and
 * PayPal account ID enabled, which these scopes request. The paypalattributes
 * scope grants the payer ID, the PayPal account ID that Payouts accepts with
 * recipient_type PAYPAL_ID.
 */
export const LOGIN_WITH_PAYPAL_SCOPES = ["openid", "profile", "email", "https://uri.paypal.com/services/paypalattributes"] as const;

export function loginWithPayPalUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL("/connect", PAYPAL_SANDBOX.webBaseUrl);
  url.searchParams.set("flowEntry", "static");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", LOGIN_WITH_PAYPAL_SCOPES.join(" "));
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  // The whole page goes to PayPal and comes back, which a phone handles better than a popup.
  url.searchParams.set("fullPage", "true");
  return url.toString();
}

const userTokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  // The Log in with PayPal reference types expires_in as a string, and its sample shows a number.
  expires_in: z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)]),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  scope: z.string().optional(),
  nonce: z.string().optional(),
});

export type LoginWithPayPalToken = z.infer<typeof userTokenSchema>;

/** Trades the authorization code from the callback for the user's access token. */
export function exchangeAuthorizationCode(rest: PayPalRestClient, code: string): Promise<LoginWithPayPalToken> {
  return rest.request({
    method: "POST",
    path: "/v1/oauth2/token",
    auth: { kind: "basic" },
    body: { kind: "form", params: new URLSearchParams({ grant_type: "authorization_code", code }) },
    schema: userTokenSchema,
  });
}

/**
 * PayPal documents two shapes. The Identity OpenAPI lists `user_id`, `sub`,
 * `name`, and a single `email`, and the paypalv1.1 schema adds `payer_id` and
 * an `emails` list. Every field is optional here, and the payer ID is read
 * from whichever field carries one.
 */
const userInfoSchema = z.looseObject({
  user_id: z.string().optional(),
  sub: z.string().optional(),
  payer_id: z.string().optional(),
  name: z.string().optional(),
  given_name: z.string().optional(),
  family_name: z.string().optional(),
  email: z.string().optional(),
  emails: z.array(z.looseObject({ value: z.string(), primary: z.boolean().optional(), confirmed: z.boolean().optional() })).optional(),
  verified_account: z.union([z.boolean(), z.string()]).optional(),
});

export type LoginWithPayPalUser = z.infer<typeof userInfoSchema>;

export function getUserInfo(rest: PayPalRestClient, userAccessToken: string): Promise<LoginWithPayPalUser> {
  return rest.request({
    method: "GET",
    path: "/v1/identity/oauth2/userinfo",
    query: { schema: "paypalv1.1" },
    auth: { kind: "bearer", token: userAccessToken },
    schema: userInfoSchema,
  });
}

/** PayPal payer IDs are 13 uppercase letters and digits, such as the ones Orders reports for a payer. */
const PAYER_ID = /^[A-Z0-9]{13}$/;

export type PayerIdField = "payer_id" | "user_id" | "sub";

/** The payer ID and the field it came from, or null when no field carries one. */
export function payerIdOf(user: LoginWithPayPalUser): { payerId: string; field: PayerIdField } | null {
  for (const field of ["payer_id", "user_id", "sub"] as const) {
    const value = user[field];
    if (value !== undefined && PAYER_ID.test(value)) return { payerId: value, field };
  }
  return null;
}

/** The account's email, the primary one when PayPal lists several. */
export function emailOf(user: LoginWithPayPalUser): string | null {
  const listed = user.emails?.find((entry) => entry.primary === true) ?? user.emails?.[0];
  const email = (listed?.value ?? user.email)?.trim().toLowerCase();
  return email === undefined || email === "" ? null : email;
}

export function nameOf(user: LoginWithPayPalUser): string | null {
  const full = user.name?.trim() || [user.given_name, user.family_name].filter(Boolean).join(" ").trim();
  return full === "" ? null : full;
}
