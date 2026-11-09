import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The seller identity. Buyers stay anonymous, and a seller signs in with
 * PayPal, because payouts need the PayPal account. The cookie names the
 * seller's user row and when it expires, signed with SESSION_SECRET under its
 * own label so a demo session cookie can never pass as one.
 */

export const SELLER_COOKIE = "roomover_seller";
/** Holds the OAuth state between the redirect to PayPal and the callback. */
export const LOGIN_STATE_COOKIE = "roomover_login_state";

const VERSION = "v1";
const SELLER_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const STATE_MAX_AGE_SECONDS = 60 * 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATE = /^[A-Za-z0-9_-]{24}$/;

function mac(label: string, payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`${label}.${payload}`).digest("base64url");
}

function sameMac(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signSeller(userId: string, secret: string, now: Date): string {
  const expires = Math.floor(now.getTime() / 1000) + SELLER_MAX_AGE_SECONDS;
  const payload = `${VERSION}.${userId}.${expires}`;
  return `${payload}.${mac("seller", payload, secret)}`;
}

/** The seller's user ID, or null when the cookie is missing, expired, malformed, or signed with another secret. */
export function verifySeller(value: string | undefined, secret: string, now: Date): string | null {
  if (value === undefined) return null;
  const [version, userId, expires, signature, ...rest] = value.split(".");
  if (version !== VERSION || userId === undefined || expires === undefined || signature === undefined || rest.length > 0) return null;
  if (!UUID.test(userId) || !/^\d{10}$/.test(expires)) return null;
  if (!sameMac(mac("seller", `${version}.${userId}.${expires}`, secret), signature)) return null;
  return Number(expires) * 1000 > now.getTime() ? userId : null;
}

export function newLoginState(): string {
  return randomBytes(18).toString("base64url");
}

export function signLoginState(state: string, secret: string): string {
  return `${state}.${mac("login-state", state, secret)}`;
}

/** Whether the state PayPal sent back is the one this browser was sent off with. */
export function checkLoginState(cookie: string | undefined, returned: string | null, secret: string): boolean {
  if (cookie === undefined || returned === null || !STATE.test(returned)) return false;
  const [state, signature, ...rest] = cookie.split(".");
  if (state === undefined || signature === undefined || rest.length > 0) return false;
  return sameMac(mac("login-state", state, secret), signature) && sameMac(state, returned);
}

export function sellerCookieOptions(secure: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: SELLER_MAX_AGE_SECONDS };
}

/** Lax, so the cookie rides along when PayPal sends the browser back with a top level GET. */
export function loginStateCookieOptions(secure: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/api/auth/paypal", maxAge: STATE_MAX_AGE_SECONDS };
}
