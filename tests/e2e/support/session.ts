import { randomBytes } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import { Client } from "pg";
import { readConfig } from "@/lib/config";
import { tlsFor } from "@/lib/db/client";
import { SESSION_COOKIE, signSession } from "@/lib/session";
import { removeSessionData } from "./remove-session";

/** Every plan, run, event, and order an e2e test creates belongs to a session whose ID starts with this tag. */
export const E2E_TAG = "e2e-";

export function taggedSessionId(): string {
  // 4 tag characters and 20 random ones make the 24 characters a session ID has.
  return `${E2E_TAG}${randomBytes(15).toString("base64url")}`;
}

/** Tests that buy listings, or need the recorded ones on sale, share the demo catalog, so they take turns. */
const CATALOG_LOCK = 0x524f4f4d;

/** Holds a Postgres advisory lock on its own connection until released. */
async function lockCatalog(): Promise<() => Promise<void>> {
  const { DATABASE_URL } = readConfig(["DATABASE_URL"]);
  const client = new Client({ connectionString: DATABASE_URL, ssl: tlsFor(DATABASE_URL) });
  await client.connect();
  await client.query("select pg_advisory_lock($1)", [CATALOG_LOCK]);
  return async () => {
    await client.query("select pg_advisory_unlock($1)", [CATALOG_LOCK]);
    await client.end();
  };
}

/**
 * Starts each test in a browser that already holds a tagged demo session,
 * and deletes what that session created when the test ends, pass or fail.
 * A test that sets `holdsCatalog` holds the catalog from before its session
 * starts until its teardown has put the listings back, so no other test buys
 * or restores the same ones meanwhile.
 */
export const test = base.extend<{ session: string; holdsCatalog: boolean }>({
  holdsCatalog: [false, { option: true }],
  session: [
    async ({ context, baseURL, holdsCatalog }, use) => {
      if (baseURL === undefined) throw new Error("E2e sessions need a base URL.");
      const release = holdsCatalog ? await lockCatalog() : null;
      const id = taggedSessionId();
      const { SESSION_SECRET } = readConfig(["SESSION_SECRET"]);
      await context.addCookies([{ name: SESSION_COOKIE, value: signSession(id, SESSION_SECRET), url: baseURL, httpOnly: true, sameSite: "Lax" }]);
      // Playwright comes back here after the test, passed or failed.
      await use(id);
      await removeSessionData({ id }).finally(() => release?.());
    },
    { auto: true, timeout: 600_000 },
  ],
});

export { expect };
