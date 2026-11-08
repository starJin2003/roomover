import { z } from "zod";
import { PAYPAL_SANDBOX } from "@/lib/paypal/config";
import type { PayPalRestClient } from "@/lib/paypal/rest/client";

/**
 * Log in with PayPal (OpenID Connect). The paypalattributes scope grants the
 * payer ID, the PayPal account ID that Payouts accepts with recipient_type
 * PAYPAL_ID. Roomover stores it for each seller.
 */
const LOGIN_WITH_PAYPAL_SCOPES = ["openid", "email", "https://uri.paypal.com/services/paypalattributes"];

export function loginWithPayPalUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL("/connect", PAYPAL_SANDBOX.webBaseUrl);
  url.searchParams.set("flowEntry", "static");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", LOGIN_WITH_PAYPAL_SCOPES.join(" "));
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

const userTokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  // The Log in with PayPal reference shows expires_in as a string ("28800").
  expires_in: z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)]),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  scope: z.string().optional(),
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

const userInfoSchema = z.object({
  user_id: z.string(),
  payer_id: z.string().optional(),
  name: z.string().optional(),
  emails: z
    .array(z.object({ value: z.string(), primary: z.boolean().optional(), confirmed: z.boolean().optional() }))
    .optional(),
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
