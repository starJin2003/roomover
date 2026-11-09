import { randomBytes } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import { readConfig } from "@/lib/config";
import { SESSION_COOKIE, signSession } from "@/lib/session";
import { removeSessionData } from "./remove-session";

/** Every plan, run, event, and order an e2e test creates belongs to a session whose ID starts with this tag. */
export const E2E_TAG = "e2e-";

export function taggedSessionId(): string {
  // 4 tag characters and 20 random ones make the 24 characters a session ID has.
  return `${E2E_TAG}${randomBytes(15).toString("base64url")}`;
}

/**
 * Starts each test in a browser that already holds a tagged demo session,
 * and deletes what that session created when the test ends, pass or fail.
 */
export const test = base.extend<{ session: string }>({
  session: [
    async ({ context, baseURL }, use) => {
      if (baseURL === undefined) throw new Error("E2e sessions need a base URL.");
      const id = taggedSessionId();
      const { SESSION_SECRET } = readConfig(["SESSION_SECRET"]);
      await context.addCookies([{ name: SESSION_COOKIE, value: signSession(id, SESSION_SECRET), url: baseURL, httpOnly: true, sameSite: "Lax" }]);
      await use(id);
      await removeSessionData({ id });
    },
    { auto: true },
  ],
});

export { expect };
