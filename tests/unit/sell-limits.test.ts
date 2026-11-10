import { beforeEach, describe, expect, it, vi } from "vitest";
import { decideLimit, RUN_LIMITS, SELL_LIMITS } from "@/lib/agents/limits";

/**
 * Sell spending guards against an in-memory draft store. A describe run
 * reserves the calls its photo has left under the limit lock, writes what it
 * spent, and counts by the time it ran.
 */

const NOW = new Date("2026-11-10T09:00:00Z");

const state = vi.hoisted(() => ({
  draftsToday: 0,
  storedBytes: 0,
  callsForDraft: 0,
  callsToday: 0,
  reservations: [] as { id: string; calls: number; at: Date }[],
  settled: [] as { id: string; calls: number }[],
  maxCalls: [] as number[],
  inserted: 0,
  describeCalls: 2,
}));

vi.mock("@/lib/db/sell", () => ({
  LISTING_PHOTO_PATH: "/api/listings/photos/",
  draftsToday: async () => state.draftsToday,
  storedSellPhotoBytes: async () => state.storedBytes,
  sellerCallsForDraft: async () => state.callsForDraft,
  reserveSellerCalls: async (_db: unknown, input: { calls: number; at: Date }) => {
    const id = `reservation-${state.reservations.length + 1}`;
    state.reservations.push({ id, calls: input.calls, at: input.at });
    return id;
  },
  settleSellerCalls: async (_db: unknown, id: string, calls: number) => {
    state.settled.push({ id, calls });
  },
  insertListingPhoto: async () => "photo-1",
  insertDraft: async () => {
    state.inserted += 1;
    return "draft-1";
  },
  loadDraft: async () => ({ id: "draft-1", status: "failed", sampleSrc: "/sell-samples/cart.jpg", photoId: null, photoSha256: "abc", channel3: { candidates: [], credits: 0, cached: true, latencyMs: 0 } }),
  markDescribeStarted: async () => undefined,
  recordDescribe: async () => undefined,
}));
vi.mock("@/lib/db/plans", () => ({
  lockRunLimits: async () => undefined,
  windowCount: async () => ({ count: 0, oldest: null }),
  claudeCallsToday: async () => state.callsToday,
}));
vi.mock("@/lib/agents/seller/describe", () => ({
  sellerTransportFor: async () => ({ mode: "live", transport: {} }),
  describeListing: async (_transport: unknown, _photo: unknown, _candidates: unknown, maxCalls: number) => {
    state.maxCalls.push(maxCalls);
    return { ok: false, error: "The seller agent could not read this photo.", usage: { calls: Math.min(state.describeCalls, maxCalls), inputTokens: 10, outputTokens: 5 } };
  },
}));
vi.mock("@/lib/agents/verifier/facts", () => ({ readPublicPhoto: async () => Buffer.from("photo"), sha256: () => "abc" }));
vi.mock("@/lib/channel3/identify", () => ({
  Channel3Unavailable: class extends Error {},
  identifyProductByImage: async () => ({ candidates: [], credits: 0, cached: true, latencyMs: 0 }),
}));
vi.mock("@/lib/channel3/transport", () => ({ channel3Transport: () => ({}) }));
vi.mock("@/lib/sell/photos", () => ({ listingPhotoBytes: async () => ({ data: { mediaType: "image/jpeg", base64: "AAAA" } }), fetchProductPhoto: async () => null }));
vi.mock("@/lib/sell/samples", () => ({ sellSample: (slug: string) => (slug === "cart" ? { src: "/sell-samples/cart.jpg" } : undefined) }));
vi.mock("@/lib/images", () => ({ imageSize: () => ({ widthPx: 10, heightPx: 10 }) }));

const { describeDraft, startDraft, SellRefused } = await import("@/lib/sell/analyze");

const db = { transaction: async (run: (tx: unknown) => Promise<unknown>) => run(db) };
const deps = { db: db as never, now: () => NOW, sessionId: "session-1", clientHash: "hash", seller: { id: "seller-1" } as never };
const upload = { kind: "upload" as const, bytes: Buffer.from("jpeg"), contentType: "image/jpeg" as const };

beforeEach(() => {
  state.draftsToday = 0;
  state.storedBytes = 0;
  state.callsForDraft = 0;
  state.callsToday = 0;
  state.reservations = [];
  state.settled = [];
  state.maxCalls = [];
  state.inserted = 0;
  state.describeCalls = 2;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("Sell limits", () => {
  it("allow two seller agent calls a photo, 20 photos a browser a day, and 300 MB of stored uploads", () => {
    expect(SELL_LIMITS).toEqual({ callsPerDraft: 2, draftsPerSessionPerDay: 20, storedPhotoBytes: 300 * 1024 * 1024 });
  });

  it("reserve a describe's calls when it starts and replace the reservation with what it spent", async () => {
    state.describeCalls = 1;
    await describeDraft(deps, "draft-1");
    expect(state.reservations).toEqual([{ id: "reservation-1", calls: 2, at: NOW }]);
    expect(state.maxCalls).toEqual([2]);
    expect(state.settled).toEqual([{ id: "reservation-1", calls: 1 }]);
  });

  it("give a retried photo only the call it has left, and refuse it once both are spent", async () => {
    state.callsForDraft = 1;
    await describeDraft(deps, "draft-1");
    expect(state.maxCalls).toEqual([1]);
    expect(state.reservations.map((entry) => entry.calls)).toEqual([1]);

    state.callsForDraft = 2;
    const refusal = describeDraft(deps, "draft-1");
    await expect(refusal).rejects.toBeInstanceOf(SellRefused);
    await expect(describeDraft(deps, "draft-1")).rejects.toThrow("The seller agent already read this photo twice, the most the demo allows for one photo, so take a new photo to try again.");
    expect(state.maxCalls).toEqual([1]);
  });

  it("refuse a describe that would pass the shared daily allowance, counting only the calls the photo has left", async () => {
    state.callsForDraft = 1;
    state.callsToday = RUN_LIMITS.claudeCallsPerDay - 1;
    await describeDraft(deps, "draft-1");
    expect(state.maxCalls).toEqual([1]);

    state.callsForDraft = 0;
    await expect(describeDraft(deps, "draft-1")).rejects.toThrow("The demo used today's allowance of Claude calls.");
    expect(state.reservations).toHaveLength(1);
  });

  it("stop a browser at 20 photos a day", async () => {
    state.draftsToday = SELL_LIMITS.draftsPerSessionPerDay;
    await expect(startDraft(deps, { kind: "sample", slug: "cart" })).rejects.toThrow("This browser started 20 Sell photos today, the most the demo allows, and it can start more after midnight UTC.");
    expect(state.inserted).toBe(0);
  });

  it("refuse new uploads past 300 MB of stored photos, and keep the sample photos working", async () => {
    state.storedBytes = SELL_LIMITS.storedPhotoBytes;
    await expect(startDraft(deps, upload)).rejects.toThrow("The demo holds 300 MB of Sell photos right now, so new uploads pause until older ones clear, and the sample photos still work.");
    await expect(startDraft(deps, { kind: "sample", slug: "cart" })).resolves.toBe("draft-1");

    state.storedBytes = SELL_LIMITS.storedPhotoBytes - 1;
    await expect(startDraft(deps, upload)).resolves.toBe("draft-1");
  });

  it("let decideLimit reserve an exact number of calls for Sell", () => {
    const free = { session: { count: 0, oldest: null }, client: { count: 0, oldest: null } };
    expect(decideLimit({ ...free, claudeCallsToday: RUN_LIMITS.claudeCallsPerDay - 2 }, 2, NOW)).toEqual({ allowed: true });
    expect(decideLimit({ ...free, claudeCallsToday: RUN_LIMITS.claudeCallsPerDay - 1 }, 2, NOW)).toMatchObject({ allowed: false, reason: "daily" });
  });
});
