import { connection, NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { NO_STORE } from "@/lib/http";
import { readLoginWithPayPalRedirectUri } from "@/lib/paypal/config";
import { loginWithPayPalUrl } from "@/lib/paypal/rest/identity";
import { loginStateCookieOptions, newLoginState, LOGIN_STATE_COOKIE, signLoginState } from "@/lib/seller-session";

/**
 * Sends the seller to Log in with PayPal. A fresh state value goes along in
 * the URL and in a signed cookie, and the callback accepts PayPal's answer
 * only when the two agree.
 */
export async function GET(): Promise<Response> {
  // Each visit needs its own state, so this never runs at build time.
  await connection();
  const { PAYPAL_CLIENT_ID, SESSION_SECRET, APP_URL } = readConfig(["PAYPAL_CLIENT_ID", "SESSION_SECRET", "APP_URL"]);
  const state = newLoginState();
  const response = NextResponse.redirect(loginWithPayPalUrl({ clientId: PAYPAL_CLIENT_ID, redirectUri: readLoginWithPayPalRedirectUri(), state }), { status: 303, headers: NO_STORE });
  response.cookies.set(LOGIN_STATE_COOKIE, signLoginState(state, SESSION_SECRET), loginStateCookieOptions(APP_URL.startsWith("https://")));
  return response;
}
