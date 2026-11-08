import { connection } from "next/server";
import { readOptionalConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { checkDatabase } from "@/lib/health";

const DATABASE_TIMEOUT_MS = 2_000;

function buildCommit(): string | null {
  try {
    return readOptionalConfig("RENDER_GIT_COMMIT") ?? null;
  } catch {
    return null;
  }
}

/** Render's health check. 200 while Postgres answers, 503 when it does not. */
export async function GET(): Promise<Response> {
  // Runs per request, never at build time.
  await connection();
  const database = await checkDatabase(getDb, DATABASE_TIMEOUT_MS);
  return Response.json(
    { status: database.ok ? "ok" : "unavailable", commit: buildCommit(), database },
    { status: database.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
