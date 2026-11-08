import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { readConfig } from "@/lib/config";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * TLS for a connection URL, unless the URL sets its own `sslmode`, which
 * node-postgres applies over this value. Render's external hosts present a
 * publicly trusted certificate and require TLS. Its internal hosts are single
 * label names on the private network, and local databases run without TLS.
 */
export function tlsFor(databaseUrl: string): PoolConfig["ssl"] {
  const { hostname } = new URL(databaseUrl);
  if (LOCAL_HOSTS.has(hostname) || !hostname.includes(".")) return false;
  return { rejectUnauthorized: true };
}

export function createPool(databaseUrl: string, max = 10): Pool {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: tlsFor(databaseUrl),
    max,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  // An idle client that loses its connection emits here. Without a listener the process exits.
  pool.on("error", (error) => {
    console.error(`Postgres pool error: ${error.message}`);
  });
  return pool;
}

export function createDatabase(pool: Pool): Database {
  return drizzle({ client: pool, schema });
}

// Next.js dev reloads modules on every edit, so the pool lives on globalThis to keep one per process.
const cache = globalThis as typeof globalThis & { roomoverDatabase?: Database };

/** The shared database for server code. */
export function getDb(): Database {
  if (cache.roomoverDatabase === undefined) {
    const { DATABASE_URL } = readConfig(["DATABASE_URL"]);
    cache.roomoverDatabase = createDatabase(createPool(DATABASE_URL));
  }
  return cache.roomoverDatabase;
}
