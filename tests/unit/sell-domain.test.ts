import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { payoutRecipient } from "@/lib/domain/payout-recipient";
import { clampPrices, minFloorCents, priceBounds } from "@/lib/domain/pricing";
import { draftDetailsFrom, notListedSentence, placementFor, sellerVerdictSchema, sellWindows, similarReferenceCents, sizeFromRetail, toMillimeters, type Channel3Candidate, type SellerVerdict } from "@/lib/domain/sell";
import { handoffWindow } from "@/lib/domain/handoff";
import { imageSize, sniffImage } from "@/lib/images";

const verdict: SellerVerdict = {
  category: "storage",
  title: "Black 3-tier rolling utility cart",
  description: "A black metal rolling cart with three trays. It looks clean.",
  condition: "like_new",
  defects: [],
  colorName: "Black",
  colorHex: "#25262a",
  material: "Metal",
  styleTags: ["Minimal", "minimal", "practical"],
  matchedCandidate: 1,
  similarCandidates: [],
  newPriceDollars: 35,
  priceDollars: 21,
  floorDollars: 16,
};

const cart: Channel3Candidate = {
  productId: "OZSFCDr",
  title: "Råskog Utility Cart",
  brand: "Ikea",
  imageUrl: "https://cdn.trychannel3.com/cleaned/v1/cart",
  newPriceCents: 3_900,
  url: "https://buy.trychannel3.com/OZSFCDr",
  domain: "ikea.com",
  sizeMm: null,
};

describe("used price bounds", () => {
  it("caps a price at 70 percent of new in whole dollars and keeps the floor between half the price and the price", () => {
    expect(priceBounds(3_900)).toEqual({ minPriceCents: 200, maxPriceCents: 2_700 });
    expect(clampPrices({ priceCents: 2_100, floorPriceCents: 1_600 }, 3_900)).toEqual({ priceCents: 2_100, floorPriceCents: 1_600 });
    expect(clampPrices({ priceCents: 9_900, floorPriceCents: 9_900 }, 3_900)).toEqual({ priceCents: 2_700, floorPriceCents: 2_700 });
    expect(clampPrices({ priceCents: 2_000, floorPriceCents: 300 }, 3_900)).toEqual({ priceCents: 2_000, floorPriceCents: 1_000 });
  });

  it("rounds to whole dollars and never asks under $2, even for a cheap item", () => {
    expect(clampPrices({ priceCents: 349, floorPriceCents: 151 }, 750)).toEqual({ priceCents: 300, floorPriceCents: 200 });
    expect(clampPrices({ priceCents: 50, floorPriceCents: 10 }, 150)).toEqual({ priceCents: 200, floorPriceCents: 100 });
    expect(minFloorCents(2_100)).toBe(1_100);
  });

  it("prices from at most $1,500 new, so one wrong match cannot ask four figures", () => {
    expect(priceBounds(500_000).maxPriceCents).toBe(105_000);
  });
});

describe("the seller agent's verdict", () => {
  it("accepts a complete verdict and rejects out of range or unknown values", () => {
    expect(sellerVerdictSchema.safeParse(verdict).success).toBe(true);
    expect(sellerVerdictSchema.safeParse({ ...verdict, category: "television" }).success).toBe(false);
    expect(sellerVerdictSchema.safeParse({ ...verdict, colorHex: "black" }).success).toBe(false);
    expect(sellerVerdictSchema.safeParse({ ...verdict, matchedCandidate: 5 }).success).toBe(false);
    expect(sellerVerdictSchema.safeParse({ ...verdict, priceDollars: 2.5 }).success).toBe(false);
    expect(sellerVerdictSchema.safeParse({ ...verdict, title: "x".repeat(61) }).success).toBe(false);
    expect(sellerVerdictSchema.safeParse({ ...verdict, extra: true }).success).toBe(false);
  });

  it("takes the new price from the matched Channel3 candidate and clamps the proposal", () => {
    const built = draftDetailsFrom({ ...verdict, priceDollars: 40 }, [cart], { model: "claude-sonnet-5-5", attempts: 1 });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.details).toMatchObject({
      category: "storage",
      placement: "floor",
      newPriceCents: 3_900,
      newPriceSource: "channel3",
      priceCents: 2_700,
      floorPriceCents: 1_600,
      color: { name: "black", hex: "#25262A" },
      material: "metal",
      styleTags: ["minimal", "practical"],
      sizeMm: null,
    });
    expect(built.details.match?.productId).toBe("OZSFCDr");
  });

  it("uses the agent's estimate when no candidate is the same product or similar", () => {
    const built = draftDetailsFrom({ ...verdict, matchedCandidate: null, newPriceDollars: 80, priceDollars: 44, floorDollars: 34 }, [cart], { model: "claude-sonnet-5-5", attempts: 2 });
    expect(built.ok && [built.details.match, built.details.similar, built.details.newPriceSource, built.details.newPriceCents, built.details.priceCents]).toEqual([null, null, "seller_agent", 8_000, 4_400]);
  });

  it("keeps the estimate path when Channel3 returned nothing, even if the agent names a similar number", () => {
    const built = draftDetailsFrom({ ...verdict, matchedCandidate: null, similarCandidates: [1], newPriceDollars: 30, priceDollars: 15, floorDollars: 11 }, [], { model: "m", attempts: 1 });
    expect(built.ok && [built.details.similar, built.details.newPriceSource, built.details.newPriceCents, built.details.priceCents, built.details.floorPriceCents, built.details.sizeMm]).toEqual([null, "seller_agent", 3_000, 1_500, 1_100, null]);
  });

  it("ignores similar numbers when the agent found the same product", () => {
    const built = draftDetailsFrom({ ...verdict, similarCandidates: [2] }, [cart, { ...cart, productId: "B", newPriceCents: 9_900 }], { model: "m", attempts: 1 });
    expect(built.ok && [built.details.match?.productId, built.details.similar, built.details.newPriceSource, built.details.newPriceCents]).toEqual(["OZSFCDr", null, "channel3", 3_900]);
  });

  it("accepts a verdict recorded before similarCandidates existed as one with none", () => {
    const recorded: Partial<SellerVerdict> = { ...verdict };
    delete recorded.similarCandidates;
    expect(sellerVerdictSchema.parse(recorded).similarCandidates).toEqual([]);
    expect(sellerVerdictSchema.safeParse({ ...verdict, similarCandidates: [5] }).success).toBe(false);
  });
});

describe("the similar products path", () => {
  const product = (productId: string, newPriceCents: number, sizeMm: Channel3Candidate["sizeMm"] = null): Channel3Candidate => ({ ...cart, productId, title: `Cart ${productId}`, newPriceCents, sizeMm });
  const sized = { widthMm: 450, depthMm: 330, heightMm: 790 };
  const returned = [product("A", 2_999), product("B", 3_400, sized), product("C", 3_999, { widthMm: 400, depthMm: 300, heightMm: 700 }), product("D", 12_900)];
  const noMatch = { ...verdict, matchedCandidate: null, newPriceDollars: 40, priceDollars: 20, floorDollars: 16 };

  it("takes the median new price, rounded to the dollar", () => {
    expect(similarReferenceCents([product("A", 3_449)])).toBe(3_400);
    expect(similarReferenceCents([product("A", 3_450)])).toBe(3_500);
    expect(similarReferenceCents([product("A", 3_999), product("B", 2_999), product("C", 3_400)])).toBe(3_400);
    // Two middle prices average first: $29.99 and $34.00 give $31.995, which rounds to $32.
    expect(similarReferenceCents([product("A", 2_999), product("B", 3_400)])).toBe(3_200);
    expect(similarReferenceCents([product("A", 1_000), product("B", 2_000), product("C", 3_000), product("D", 10_000)])).toBe(2_500);
    expect(similarReferenceCents([product("A", 25)])).toBe(100);
    expect(() => similarReferenceCents([])).toThrow();
  });

  it("prices from the median of the picked products and keeps the agent's shares for its condition", () => {
    const built = draftDetailsFrom({ ...noMatch, similarCandidates: [2, 1, 3] }, returned, { model: "m", attempts: 1 });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // Median $34. The agent asked $20 and $16 of its own $40 estimate, so 50 and 40 percent of $34.
    expect([built.details.newPriceSource, built.details.newPriceCents, built.details.priceCents, built.details.floorPriceCents, built.details.match]).toEqual(["channel3_similar", 3_400, 1_700, 1_400, null]);
    expect(built.details.similar?.products.map((candidate) => candidate.productId)).toEqual(["B", "A", "C"]);
    expect(built.details.similar?.referenceCents).toBe(3_400);
  });

  it("suggests the size of the closest picked product that states one, and leaves the confirmed size empty", () => {
    const built = draftDetailsFrom({ ...noMatch, similarCandidates: [1, 3, 2] }, returned, { model: "m", attempts: 1 });
    expect(built.ok && [built.details.similar?.sizeMm, built.details.sizeMm]).toEqual([{ widthMm: 400, depthMm: 300, heightMm: 700 }, null]);
    const unsized = draftDetailsFrom({ ...noMatch, similarCandidates: [1] }, returned, { model: "m", attempts: 1 });
    expect(unsized.ok && [unsized.details.similar?.sizeMm, unsized.details.similar?.referenceCents]).toEqual([null, 3_000]);
  });

  it("drops repeated and missing numbers, and still clamps the price to 70 percent of the reference", () => {
    const built = draftDetailsFrom({ ...noMatch, similarCandidates: [4, 4, 9], newPriceDollars: 20, priceDollars: 18, floorDollars: 15 }, returned, { model: "m", attempts: 1 });
    expect(built.ok && built.details.similar?.products.map((candidate) => candidate.productId)).toEqual(["D"]);
    // $18 of a $20 estimate is 90 percent, which the bounds cap at 70 percent of $129, $90.
    expect(built.ok && [built.details.newPriceCents, built.details.priceCents, built.details.floorPriceCents]).toEqual([12_900, 9_000, 9_000]);
  });

  it("turns a photo of something Roomover does not list into a sentence", () => {
    const built = draftDetailsFrom({ ...verdict, category: "other", title: "White handheld fan" }, [], { model: "m", attempts: 1 });
    expect(built).toEqual({ ok: false, reason: notListedSentence("White handheld fan") });
    expect(notListedSentence("White handheld fan")).toBe("Roomover lists desks, chairs, shelves, lamps, rugs, mini fridges, storage, and bedding. This photo looks like white handheld fan, so try a photo of one of those.");
  });
});

describe("listing shape", () => {
  it("places items by category and title words", () => {
    expect(placementFor("lamp", "Brass floor lamp")).toBe("floor");
    expect(placementFor("lamp", "Black desk lamp")).toBe("surface");
    expect(placementFor("rug", "Jute rug")).toBe("underlay");
    expect(placementFor("bed_accessory", "Throw")).toBe("bed");
    expect(placementFor("storage", "Under-bed storage bin")).toBe("bed");
    expect(placementFor("storage", "Rolling cart")).toBe("floor");
  });

  it("reads retail sizes in any unit, with the longer floor side as the width", () => {
    expect(toMillimeters({ number: 17.78, unit: "cm" })).toBe(178);
    expect(toMillimeters({ number: 16, unit: "in" })).toBe(406);
    expect(sizeFromRetail({ lengthMm: 190, widthMm: 505, heightMm: 670 })).toEqual({ widthMm: 505, depthMm: 190, heightMm: 670 });
    expect(sizeFromRetail({ lengthMm: null, widthMm: 505, heightMm: 670 })).toBeNull();
  });

  it("builds windows every handoff mode can serve, and refuses a direct handoff after spring finals", () => {
    const now = new Date("2026-11-09T18:00:00Z");
    for (const mode of ["direct", "storage_hold", "same_room"] as const) {
      const windows = sellWindows("this_term", mode, now);
      expect(windows === null ? null : handoffWindow(mode, windows)).not.toBeNull();
    }
    expect(sellWindows("spring", "direct", now)).toBeNull();
    expect(sellWindows("spring", "storage_hold", now)).not.toBeNull();
  });
});

describe("payout recipient", () => {
  const account = { paypalAccountId: null, paypalEmail: "roomover-seller2-jin0608@personal.example.com", payoutWallet: "paypal" as const, venmoHandle: null };

  it("pays a seller who logged in with PayPal to the payer ID", () => {
    expect(payoutRecipient({ ...account, paypalAccountId: "6Q7LQ8XZHM8VS" })).toEqual({ recipientType: "PAYPAL_ID", receiver: "6Q7LQ8XZHM8VS", wallet: "paypal" });
  });

  it("falls back to the sandbox email for a seeded seller, a Venmo handle for Venmo, and nothing when there is no account", () => {
    expect(payoutRecipient(account)).toEqual({ recipientType: "EMAIL", receiver: account.paypalEmail, wallet: "paypal" });
    expect(payoutRecipient({ ...account, payoutWallet: "venmo", venmoHandle: "@marcus" })).toEqual({ recipientType: "USER_HANDLE", receiver: "@marcus", wallet: "venmo" });
    expect(payoutRecipient({ ...account, paypalEmail: null })).toBeNull();
  });
});

describe("photo headers", () => {
  it("reads the pixel size of committed JPEG samples", () => {
    const bytes = readFileSync("public/sell-samples/black-rolling-cart.jpg");
    expect(sniffImage(bytes)).toBe("image/jpeg");
    expect(imageSize(bytes, "image/jpeg")).toEqual({ widthPx: 953, heightPx: 1200 });
  });

  it("reads PNG headers and refuses a truncated file", () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(imageSize(png, "image/png")).toEqual({ widthPx: 640, heightPx: 480 });
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg")).toBeNull();
  });
});
