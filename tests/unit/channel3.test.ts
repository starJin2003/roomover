import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "@/lib/agents/verifier/facts";
import { decideChannel3Limit } from "@/lib/channel3/limits";
import { candidatesFrom } from "@/lib/channel3/products";
import { readChannel3Recording, type Channel3Transport } from "@/lib/channel3/transport";
import type { Channel3Candidate } from "@/lib/domain/sell";

const state = vi.hoisted(() => ({
  cache: new Map<string, { candidates: unknown[]; productCount: number }>(),
  stored: [] as { imageSha256: string; credits: number; sessionId: string }[],
  today: { sessionToday: 0, allToday: 0 },
}));

vi.mock("@/lib/db/sell", () => ({
  loadChannel3Lookup: async (_db: unknown, sha: string) => state.cache.get(sha) ?? null,
  storeChannel3Lookup: async (_db: unknown, row: { imageSha256: string; credits: number; sessionId: string; candidates: unknown[]; productCount: number }) => {
    state.stored.push({ imageSha256: row.imageSha256, credits: row.credits, sessionId: row.sessionId });
    state.cache.set(row.imageSha256, { candidates: row.candidates, productCount: row.productCount });
  },
  channel3SearchesToday: async () => state.today,
}));

const { Channel3Unavailable, identifyProductByImage } = await import("@/lib/channel3/identify");

const NOW = new Date("2026-11-09T18:00:00Z");
const cartBytes = readFileSync("public/sell-samples/black-rolling-cart.jpg");
const cartSha = sha256(cartBytes);

function transport(mode: "live" | "fixture", answer: () => Promise<unknown>): Channel3Transport & { calls: number } {
  const counted = { mode, calls: 0, async searchText() {
    throw new Error("No text search in this test.");
  }, async searchByImage() {
    counted.calls += 1;
    return answer();
  } };
  return counted;
}

const recorded = async () => (await readChannel3Recording("tests/fixtures/channel3.json")).photos[cartSha];
const deps = (search: Channel3Transport) => ({ db: {} as never, transport: search, now: () => NOW, sessionId: "session-a" });

beforeEach(() => {
  state.cache = new Map();
  state.stored = [];
  state.today = { sessionToday: 0, allToday: 0 };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("Channel3 product parsing", () => {
  it("keeps up to four products with a new US price, in Channel3's order, from the recorded cart search", async () => {
    const { candidates, productCount } = candidatesFrom(await recorded());
    expect(productCount).toBeGreaterThanOrEqual(candidates.length);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(4);
    expect(candidates[0]).toMatchObject({ title: "Råskog Utility Cart", newPriceCents: 3_900, domain: "ikea.com", sizeMm: null });
  });

  it("takes the cheapest new in stock US offer, reads stated sizes, and drops products it cannot price", () => {
    const offer = (price: number, extra: Record<string, unknown> = {}) => ({ url: "https://example.com/p", domain: "example.com", price: { price, currency: "USD" }, availability: "InStock", condition: "new", ...extra });
    const { candidates } = candidatesFrom({
      products: [
        { id: "a", title: "Desk lamp", images: [{ url: "http://insecure.example.com/a.jpg" }], offers: [offer(49.99), offer(39.5, { dimensions: { length: { number: 16, unit: "in" }, width: { number: 7, unit: "in" }, height: { number: 19, unit: "in" } } })] },
        { id: "b", title: "Used only", offers: [offer(10, { condition: "used" })] },
        { id: "c", title: "Euro lamp", offers: [{ ...offer(20), price: { price: 20, currency: "EUR" } }] },
        { id: "d" },
      ],
    });
    expect(candidates).toEqual<Channel3Candidate[]>([
      { productId: "a", title: "Desk lamp", brand: null, imageUrl: null, newPriceCents: 3_950, url: "https://example.com/p", domain: "example.com", sizeMm: { widthMm: 406, depthMm: 178, heightMm: 483 } },
    ]);
  });
});

describe("identify_product_by_image", () => {
  it("calls Channel3 once per photo, stores the answer with one credit, and answers the same photo from the cache for free", async () => {
    const live = transport("live", recorded);
    const first = await identifyProductByImage(deps(live), { sha256: cartSha, base64: "x" });
    const second = await identifyProductByImage(deps(live), { sha256: cartSha, base64: "x" });
    expect([first.credits, first.cached, second.credits, second.cached, live.calls]).toEqual([1, false, 0, true, 1]);
    expect(state.stored).toEqual([{ imageSha256: cartSha, credits: 1, sessionId: "session-a" }]);
    expect(second.candidates).toEqual(first.candidates);
  });

  it("refuses a live search past the session's daily cap before calling Channel3", async () => {
    state.today = { sessionToday: 12, allToday: 40 };
    const live = transport("live", recorded);
    await expect(identifyProductByImage(deps(live), { sha256: cartSha, base64: "x" })).rejects.toMatchObject({ name: "RunLimitError" });
    expect(live.calls).toBe(0);
  });

  it("says plainly when Channel3 does not answer", async () => {
    const down = transport("live", async () => {
      throw new Error("fetch failed");
    });
    await expect(identifyProductByImage(deps(down), { sha256: cartSha, base64: "x" })).rejects.toBeInstanceOf(Channel3Unavailable);
    expect(state.stored).toEqual([]);
  });

  it("replays a recording in tests, with no cache write and no credit", async () => {
    const replay = transport("fixture", recorded);
    const answer = await identifyProductByImage(deps(replay), { sha256: cartSha, base64: "x" });
    expect([answer.credits, answer.cached, state.stored.length]).toEqual([0, false, 0]);
  });
});

describe("Channel3 caps", () => {
  it("allows 12 live searches per browser and 300 for the demo each day", () => {
    expect(decideChannel3Limit({ sessionToday: 11, allToday: 299 }, NOW)).toEqual({ allowed: true });
    expect(decideChannel3Limit({ sessionToday: 12, allToday: 0 }, NOW)).toMatchObject({ allowed: false, reason: "session", retryAt: new Date("2026-11-10T00:00:00Z") });
    expect(decideChannel3Limit({ sessionToday: 0, allToday: 300 }, NOW)).toMatchObject({ allowed: false, reason: "daily" });
  });
});
