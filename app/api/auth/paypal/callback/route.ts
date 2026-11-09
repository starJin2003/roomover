import { connection, NextResponse, type NextRequest } from "next/server";
import { readConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { linkPayPalSeller } from "@/lib/db/sellers";
import { NO_STORE, sessionFrom } from "@/lib/http";
import { PayPalApiError } from "@/lib/paypal/errors";
import { paypalRest } from "@/lib/paypal/rest/client";
import { emailOf, exchangeAuthorizationCode, getUserInfo, nameOf, payerIdOf } from "@/lib/paypal/rest/identity";
import type { LoginOutcome } from "@/lib/sell/login";
import { checkLoginState, LOGIN_STATE_COOKIE, loginStateCookieOptions, SELLER_COOKIE, sellerCookieOptions, signSeller } from "@/lib/seller-session";
import { newSessionId, SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";

/**
 * PayPal sends the seller back here. The state must match the one this
 * browser left with, the code becomes a user token, and the user's info
 * gives the payer ID, which Roomover stores on the seller so payouts reach
 * that PayPal account, or else the account's email, which payouts use in
 * its place. The seller lands on Sell either way.
 */
export async function GET(request: NextRequest): Promise<Response> {
  // Runs per request, never at build time.
  await connection();
  const { SESSION_SECRET, APP_URL } = readConfig(["SESSION_SECRET", "APP_URL"]);
  const secure = APP_URL.startsWith("https://");
  const params = request.nextUrl.searchParams;
  const finish = (outcome: LoginOutcome | null) => {
    const target = new URL("/sell", APP_URL);
    if (outcome !== null) target.searchParams.set("login", outcome);
    const response = NextResponse.redirect(target, { status: 303, headers: NO_STORE });
    response.cookies.set(LOGIN_STATE_COOKIE, "", { ...loginStateCookieOptions(secure), maxAge: 0 });
    return response;
  };

  if (!checkLoginState(request.cookies.get(LOGIN_STATE_COOKIE)?.value, params.get("state"), SESSION_SECRET)) return finish("failed");
  if (params.get("error") !== null) return finish("canceled");
  const code = params.get("code");
  if (code === null || code === "") return finish("failed");

  let user: Awaited<ReturnType<typeof getUserInfo>>;
  try {
    const token = await exchangeAuthorizationCode(paypalRest(), code);
    user = await getUserInfo(paypalRest(), token.access_token);
  } catch (error) {
    console.error("login with paypal failed", error instanceof PayPalApiError ? { operation: error.operation, status: error.status, debugId: error.debugId } : { error: error instanceof Error ? error.name : "unknown" });
    return finish("failed");
  }
  const payer = payerIdOf(user);
  // Field names only, never values, so the payer ID's home in the response is on record.
  console.info("login with paypal userinfo", { fields: Object.keys(user).sort(), payerIdField: payer?.field ?? null });
  const link = await linkPayPalSeller(getDb(), { payerId: payer?.payerId ?? null, email: emailOf(user), name: nameOf(user) });
  if (!link.ok) return finish(link.reason);

  const response = finish(null);
  response.cookies.set(SELLER_COOKIE, signSeller(link.userId, SESSION_SECRET, new Date()), sellerCookieOptions(secure));
  if (sessionFrom(request) === null) response.cookies.set(SESSION_COOKIE, signSession(newSessionId(), SESSION_SECRET), sessionCookieOptions(secure));
  return response;
}
