import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { NO_STORE } from "@/lib/http";
import { SELLER_COOKIE, sellerCookieOptions } from "@/lib/seller-session";

/** Forgets the seller in this browser. The PayPal account stays linked to the seller for payouts. */
export async function POST(): Promise<Response> {
  const { APP_URL } = readConfig(["APP_URL"]);
  const response = NextResponse.redirect(new URL("/sell", APP_URL), { status: 303, headers: NO_STORE });
  response.cookies.set(SELLER_COOKIE, "", { ...sellerCookieOptions(APP_URL.startsWith("https://")), maxAge: 0 });
  return response;
}
