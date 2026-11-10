import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { MCP_SESSION_TAG } from "@/lib/domain/mcp";

/**
 * The demo identity. Buyers do not log in, so judges can test freely. Each
 * browser gets a random session ID signed with SESSION_SECRET, and every
 * session acts as the seeded judge buyer while seeing only its own plans.
 */

export const SESSION_COOKIE = "roomover_session";
const VERSION = "v1";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SESSION_ID = /^[A-Za-z0-9_-]{24}$/;

function signature(id: string, secret: string): string {
  return createHmac("sha256", secret).update(`${VERSION}.${id}`).digest("base64url");
}

export function newSessionId(): string {
  return randomBytes(18).toString("base64url");
}

export function signSession(id: string, secret: string): string {
  return `${VERSION}.${id}.${signature(id, secret)}`;
}

/** The session ID from a cookie value, or null when the value is missing, malformed, or signed with another secret. */
export function verifySession(value: string | undefined, secret: string): string | null {
  if (value === undefined) return null;
  const [version, id, mac, ...rest] = value.split(".");
  if (version !== VERSION || id === undefined || mac === undefined || rest.length > 0 || !SESSION_ID.test(id)) return null;
  const expected = Buffer.from(signature(id, secret));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

export function sessionCookieOptions(secure: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: MAX_AGE_SECONDS };
}

/**
 * The client address every limit keys on. Cloudflare fronts each public
 * Render web service: it appends the address it saw to X-Forwarded-For and
 * writes that same address to CF-Connecting-IP, overwriting any copy the
 * caller sent (render.com/articles/host-pocketbase-on-render). Entries a
 * caller puts in X-Forwarded-For stay in front of Cloudflare's, so the
 * leftmost entry can claim any address. Roomover reads CF-Connecting-IP,
 * and the entry the nearest proxy appended (the last one) where no
 * Cloudflare header exists, as on a local server.
 */
export function clientAddress(headers: Headers): string {
  const connecting = headers.get("cf-connecting-ip")?.trim();
  if (connecting) return connecting;
  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .at(-1);
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

/** A keyed hash of the client address, so rate limits work without storing addresses. */
export function clientHash(address: string, secret: string): string {
  return createHmac("sha256", secret).update(`client.${address}`).digest("hex").slice(0, 32);
}

/** The buyer session an MCP session acts through, keyed so that no client can name another session's plans. */
export function mcpBuyerSession(mcpSessionId: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(`mcp.${mcpSessionId}`).digest("base64url");
  return `${MCP_SESSION_TAG}${digest.slice(0, 20)}`;
}
