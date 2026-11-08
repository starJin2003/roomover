import { sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";

export interface DatabaseCheck {
  readonly ok: boolean;
  readonly latencyMs: number;
}

const TIMED_OUT = Symbol("timed out");

/**
 * One round trip to Postgres. It gives up after `timeoutMs` so the health
 * check answers inside the 5 seconds Render waits. Failures log the error
 * name only, because driver messages can repeat connection details.
 */
export async function checkDatabase(
  connect: () => Pick<Database, "execute">,
  timeoutMs: number,
): Promise<DatabaseCheck> {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    });
    const result = await Promise.race([connect().execute(sql`select 1`), deadline]);
    if (result === TIMED_OUT) {
      console.error("health check: database round trip timed out", { timeoutMs });
      return { ok: false, latencyMs: elapsed() };
    }
    return { ok: true, latencyMs: elapsed() };
  } catch (error) {
    console.error("health check: database round trip failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return { ok: false, latencyMs: elapsed() };
  } finally {
    clearTimeout(timer);
  }
}
