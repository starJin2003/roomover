import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ execute: vi.fn<() => Promise<unknown>>() }));
const connectionError = vi.hoisted(() => ({ value: undefined as Error | undefined }));

vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/lib/db/client", () => ({
  getDb: () => {
    if (connectionError.value !== undefined) throw connectionError.value;
    return database;
  },
}));

const COMMIT = "28c438e0a1b2c3d4e5f60718293a4b5c6d7e8f90";

async function getHealth() {
  const { GET } = await import("@/app/api/health/route");
  const response = await GET();
  return { status: response.status, cache: response.headers.get("Cache-Control"), body: await response.json() };
}

describe("GET /api/health", () => {
  beforeEach(() => {
    connectionError.value = undefined;
    database.execute.mockReset();
    vi.stubEnv("RENDER_GIT_COMMIT", COMMIT);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("answers 200 with the build commit when Postgres answers", async () => {
    database.execute.mockResolvedValue({ rows: [{ "?column?": 1 }] });

    const health = await getHealth();

    expect(health.status).toBe(200);
    expect(health.cache).toBe("no-store");
    expect(health.body).toEqual({ status: "ok", commit: COMMIT, database: { ok: true, latencyMs: expect.any(Number) } });
    expect(database.execute).toHaveBeenCalledTimes(1);
  });

  it("answers 503 when the query fails and keeps the error out of the response", async () => {
    database.execute.mockRejectedValue(new Error("connect ECONNREFUSED dpg-secret-host:5432"));

    const health = await getHealth();

    expect(health.status).toBe(503);
    expect(health.body).toEqual({ status: "unavailable", commit: COMMIT, database: { ok: false, latencyMs: expect.any(Number) } });
    expect(JSON.stringify(health.body)).not.toContain("dpg-secret-host");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("dpg-secret-host");
  });

  it("answers 503 when DATABASE_URL is missing", async () => {
    connectionError.value = new Error("Environment variable DATABASE_URL is not set.");

    const health = await getHealth();

    expect(health.status).toBe(503);
    expect(health.body.database.ok).toBe(false);
  });

  it("answers 503 after 2 seconds when Postgres hangs", async () => {
    vi.useFakeTimers();
    database.execute.mockReturnValue(new Promise(() => undefined));

    const pending = getHealth();
    await vi.advanceTimersByTimeAsync(2_000);
    const health = await pending;

    expect(health.status).toBe(503);
    expect(health.body.database.ok).toBe(false);
  });

  it("reports a null commit outside Render", async () => {
    vi.stubEnv("RENDER_GIT_COMMIT", undefined);
    database.execute.mockResolvedValue({ rows: [] });

    expect((await getHealth()).body.commit).toBeNull();
  });
});
