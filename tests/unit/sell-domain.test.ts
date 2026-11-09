import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { payoutRecipient } from "@/lib/domain/payout-recipient";
import { clampPrices, minFloorCents, priceBounds } from "@/lib/domain/pricing";
import { draftDetailsFrom, notListedSentence, placementFor, sellerVerdictSchema, sellWindows, sizeFromRetail, toMillimeters, type Channel3Candidate, type SellerVerdict } from "@/lib/domain/sell";
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

  it("uses the agent's estimate when no candidate is the same product", () => {
    const built = draftDetailsFrom({ ...verdict, matchedCandidate: null, newPriceDollars: 80, priceDollars: 44, floorDollars: 34 }, [cart], { model: "claude-sonnet-5-5", attempts: 2 });
    expect(built.ok && [built.details.match, built.details.newPriceSource, built.details.newPriceCents, built.details.priceCents]).toEqual([null, "seller_agent", 8_000, 4_400]);
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
