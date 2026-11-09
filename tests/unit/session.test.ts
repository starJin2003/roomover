import { describe, expect, it } from "vitest";
import { clientAddress, clientHash, newSessionId, sessionCookieOptions, signSession, verifySession } from "@/lib/session";

const SECRET = "s".repeat(32);

describe("demo session cookie", () => {
  it("verifies its own signature and returns the session ID", () => {
    const id = newSessionId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(verifySession(signSession(id, SECRET), SECRET)).toBe(id);
  });

  it("rejects a tampered ID, another secret, and malformed values", () => {
    const value = signSession(newSessionId(), SECRET);
    const [version, , mac] = value.split(".");
    expect(verifySession(`${version}.${newSessionId()}.${mac}`, SECRET)).toBeNull();
    expect(verifySession(value, "t".repeat(32))).toBeNull();
    expect(verifySession(undefined, SECRET)).toBeNull();
    expect(verifySession("v1.short.mac", SECRET)).toBeNull();
    expect(verifySession(`${value}.extra`, SECRET)).toBeNull();
    expect(verifySession(value.replace("v1.", "v2."), SECRET)).toBeNull();
  });

  it("is HTTP only and same site, and secure only on HTTPS", () => {
    expect(sessionCookieOptions(true)).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/" });
    expect(sessionCookieOptions(false).secure).toBe(false);
  });
});

describe("client address", () => {
  it("takes the first X-Forwarded-For entry and falls back to X-Real-IP", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.2" }))).toBe("203.0.113.7");
    expect(clientAddress(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientAddress(new Headers())).toBe("unknown");
  });

  it("hashes the address with the secret so the address is never stored", () => {
    const hash = clientHash("203.0.113.7", SECRET);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).toBe(clientHash("203.0.113.7", SECRET));
    expect(hash).not.toBe(clientHash("203.0.113.7", "t".repeat(32)));
    expect(hash).not.toContain("203");
  });
});
