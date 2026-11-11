import { describe, expect, it } from "vitest";
import type { DraftRow } from "@/lib/db/sell";
import { draftDetailsFrom, type Channel3Candidate, type SellerVerdict } from "@/lib/domain/sell";
import { draftView } from "@/lib/sell/view";
import { sourceSentence } from "@/lib/sell/words";

const cart = (productId: string, newPriceCents: number, domain = "target.com", sizeMm: Channel3Candidate["sizeMm"] = null): Channel3Candidate => ({
  productId,
  title: `Black rolling cart ${productId}`,
  brand: null,
  imageUrl: null,
  newPriceCents,
  url: `https://buy.trychannel3.com/${productId}`,
  domain,
  sizeMm,
});

const verdict: SellerVerdict = {
  category: "storage",
  title: "Black 3-tier rolling utility cart",
  description: "A black metal rolling cart with three trays. It looks clean.",
  condition: "like_new",
  defects: [],
  colorName: "Black",
  colorHex: "#25262A",
  material: "Metal",
  styleTags: ["minimal"],
  matchedCandidate: null,
  similarCandidates: [],
  newPriceDollars: 35,
  priceDollars: 18,
  floorDollars: 13,
};

const SIZED = { widthMm: 457, depthMm: 356, heightMm: 787 };
const returned = [cart("A", 2_999, "walmart.com"), cart("B", 3_400, "www.target.com", SIZED), cart("C", 3_999, "ikea.com"), cart("D", 8_900)];

function draftFor(choice: Partial<SellerVerdict>, candidates: Channel3Candidate[] = returned, unavailable: string | null = null): DraftRow {
  const built = draftDetailsFrom({ ...verdict, ...choice }, candidates, { model: "claude-sonnet-5-5", attempts: 1 });
  if (!built.ok) throw new Error(built.reason);
  return {
    id: "draft",
    sellerId: "ava",
    sessionId: "session",
    status: "ready",
    sampleSrc: "/sell-samples/black-rolling-cart.jpg",
    photoId: null,
    photoSha256: "0".repeat(64),
    channel3: { candidates, credits: 1, cached: false, latencyMs: 1_400, unavailable },
    details: built.details,
    error: null,
    claudeMode: "fixture",
    claudeCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    describeMs: 900,
    listingId: null,
    createdAt: new Date("2026-11-11T12:00:00Z"),
  };
}

describe("the sentence under the listing title", () => {
  it("names Channel3's new price for the same product, and asks for a size when Channel3 has none", () => {
    expect(sourceSentence(draftView(draftFor({ matchedCandidate: 2 })))).toBe("Filled in from your photo. New about $34.");
    expect(sourceSentence(draftView(draftFor({ matchedCandidate: 1 })))).toBe("Filled in from your photo. New about $29.99. Channel3 has no size for this product, so enter it yourself.");
  });

  it("says there is no exact match and prices from the similar items, never calling them a match", () => {
    const three = sourceSentence(draftView(draftFor({ similarCandidates: [2, 1, 3] })));
    expect(three).toBe("Filled in from your photo. No exact match on Channel3. 3 similar items sell new for about $34, so your price starts there.");
    expect(three).not.toMatch(/\bmatches\b/);
    expect(sourceSentence(draftView(draftFor({ similarCandidates: [4] })))).toBe("Filled in from your photo. No exact match on Channel3. 1 similar item sells new for about $89, so your price starts there.");
  });

  it("keeps the estimate wording when Channel3 returned nothing or nothing similar", () => {
    const words = "Filled in from your photo. Channel3 found no product that matches it, so the seller agent estimated the new price, about $35, and you enter the size.";
    expect(sourceSentence(draftView(draftFor({}, [])))).toBe(words);
    expect(sourceSentence(draftView(draftFor({})))).toBe(words);
    expect(sourceSentence(draftView(draftFor({}, [], "Channel3 did not answer just now.")))).toBe("Filled in from your photo. Channel3 did not answer just now. The seller agent estimated the new price, about $35, so enter the size yourself.");
  });
});

describe("the Sell view of the similar path", () => {
  it("lists the picked products closest first with their retailers, marks them among everything returned, and offers the closest stated size", () => {
    const view = draftView(draftFor({ similarCandidates: [1, 2, 3] }));
    expect(view.similar).toEqual({
      products: [
        { productId: "A", title: "Black rolling cart A", retailer: "walmart.com", newPriceCents: 2_999 },
        { productId: "B", title: "Black rolling cart B", retailer: "target.com", newPriceCents: 3_400 },
        { productId: "C", title: "Black rolling cart C", retailer: "ikea.com", newPriceCents: 3_999 },
      ],
      referenceCents: 3_400,
      sizeMm: [457, 356, 787],
    });
    expect(view.channel3.candidates.map((candidate) => [candidate.productId, candidate.picked])).toEqual([["A", true], ["B", true], ["C", true], ["D", false]]);
    expect(view.channel3.query).toBe("Your photo as base64, limit 6, US, USD, lengths in cm");
    expect([view.match, view.details?.newPriceSource, view.details?.sizeMm, view.details?.maxPriceCents]).toEqual([null, "channel3_similar", null, 2_300]);
  });

  it("reads a draft stored before similar products were kept as one without them", () => {
    const draft = draftFor({});
    const stored = structuredClone(draft.details);
    if (stored !== null) delete stored.similar;
    const view = draftView({ ...draft, details: stored });
    expect([view.similar, view.channel3.candidates.every((candidate) => !candidate.picked)]).toEqual([null, true]);
  });
});
