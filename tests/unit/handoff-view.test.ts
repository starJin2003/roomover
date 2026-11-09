import { describe, expect, it } from "vitest";
import type { HandoffItem, HandoffOrder } from "@/lib/db/handoffs";
import { sampleFor, samplesFor } from "@/lib/handoff/samples";
import { sniffImage } from "@/lib/images";
import { buildHandoffView, type LayoutRef } from "@/lib/handoff/view";
import { decisionSentence, findingSentence, moneyBackSentence, rowNote } from "@/lib/handoff/words";
import { seedListings } from "@/scripts/seed/listings";
import { existsSync } from "node:fs";

const chair = { sellerFirstName: "Marcus", noun: "chair", priceCents: 3_500 };
const tear = { kind: "tear" as const, location: "seat cover", sizeCm: 3, severity: "minor" as const };

describe("handoff sentences", () => {
  it("tells the torn chair story in the agreed sentences", () => {
    expect(findingSentence(chair, "new_damage", tear)).toBe("Marcus's chair has a new 3 cm tear. You pay $30 of $35.");
    expect(moneyBackSentence(chair, 500, tear, true)).toBe("You got $5 back for the chair's new tear.");
  });

  it("covers every verdict and decision", () => {
    expect(findingSentence({ sellerFirstName: "Jun", noun: "desk", priceCents: 5_500 }, "match", null)).toBe("Jun's desk matches the listing.");
    expect(findingSentence(chair, "new_damage", { ...tear, sizeCm: 14, severity: "major" })).toBe("Marcus's chair has a new 14 cm tear. Keep it for $17.50 or turn it down.");
    expect(findingSentence(chair, "wrong_item", null)).toBe("This is not the chair Marcus listed. Turn it down and you pay nothing for it.");
    expect(findingSentence(chair, "missing", null)).toBe("The photo does not show Marcus's chair. Take another, or tell Roomover it was not there.");
    expect(decisionSentence(chair, "adjusted", 3_000)).toBe("You kept Marcus's chair for $30 of $35.");
    expect(decisionSentence(chair, "missing", 0)).toBe("Marcus's chair was not there, so you pay nothing for it.");
    expect(moneyBackSentence(chair, 3_500, null, false)).toBe("You got $35 back for Marcus's chair.");
    expect(rowNote("new_damage", tear, "adjusted", 3_000)).toBe("new tear, you pay $30");
    expect(rowNote("match", null, "rejected", 0)).toBe("turned down, you pay nothing");
  });
});

describe("sample photos", () => {
  it("exist for every seed listing, with a torn copy of the mesh desk chair only", () => {
    const listings = seedListings("2026-11-08");
    for (const listing of listings) {
      const samples = samplesFor(listing.photos[0].src);
      expect(samples[0].kind).toBe("as_listed");
      for (const sample of samples) expect(existsSync(`public${sample.src}`)).toBe(true);
    }
    expect(listings.filter((listing) => samplesFor(listing.photos[0].src).length === 2).map((listing) => listing.photos[0].src)).toEqual(["/seed/listings/marcus-mesh-desk-chair.jpg"]);
    expect(sampleFor("/seed/listings/marcus-mesh-desk-chair.jpg", "torn")?.src).toBe("/handoff-samples/marcus-mesh-desk-chair-torn.jpg");
    expect(samplesFor("https://example.com/upload.jpg")).toEqual([]);
  });
});

describe("upload checks", () => {
  it("reads the image type from the first bytes and refuses anything else", () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe("image/jpeg");
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe("image/png");
    expect(sniffImage(Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]))).toBe("image/webp");
    expect(sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImage(Buffer.from("GIF89a"))).toBeNull();
  });
});

function item(id: string, sellerId: string, sellerName: string, amountCents: number, handoff: Partial<NonNullable<HandoffItem["handoff"]>> | null): HandoffItem {
  return {
    orderItemId: id,
    listingId: `listing-${id}`,
    sellerId,
    sellerName,
    title: `Item ${id}`,
    description: "",
    widthMm: 1,
    depthMm: 1,
    heightMm: 1,
    conditionReport: { grade: "good", notes: "Fine", defects: [], assessedBy: "seller" },
    photos: [{ src: `/seed/listings/${id === "chair" ? "marcus-mesh-desk-chair" : "jun-white-desk"}.jpg`, alt: id, widthPx: 1, heightPx: 1 }],
    listingStatus: "reserved",
    handoffMode: "direct",
    moveOutStartsAt: new Date("2026-11-20T00:00:00Z"),
    moveOutEndsAt: new Date("2026-11-30T00:00:00Z"),
    moveInStartsAt: new Date("2026-11-22T00:00:00Z"),
    moveInEndsAt: new Date("2026-11-25T00:00:00Z"),
    amountCents,
    capturedAmountCents: 0,
    refundedAmountCents: 0,
    status: "authorized",
    paypalCaptureId: null,
    paypalRefundId: null,
    slot: null,
    attempt: 1,
    handoff:
      handoff === null
        ? null
        : {
            id: `h-${id}`,
            mode: "direct",
            status: "scheduled",
            slotStartsAt: new Date("2026-11-22T00:00:00Z"),
            slotEndsAt: new Date("2026-11-25T00:00:00Z"),
            location: "Harbor Hall 214",
            photos: [],
            report: null,
            verifierError: null,
            decision: null,
            payCents: null,
            decidedAt: null,
            ...handoff,
          },
  };
}

describe("buildHandoffView", () => {
  const layout = new Map<string, LayoutRef>([
    ["listing-desk", { key: "jun-white-desk", furnitureType: "desk", index: 0 }],
    ["listing-chair", { key: "marcus-mesh-desk-chair", furnitureType: "desk_chair", index: 1 }],
  ]);
  const order = (items: HandoffItem[]): HandoffOrder => ({
    id: "order-1",
    planId: "plan-1",
    sessionId: "s",
    paymentMode: "authorize_then_capture",
    status: "authorized",
    totalCents: 9_000,
    paypalOrderId: "ORDER",
    paypalAuthorizationId: "AUTH",
    paypalReauthorizationId: null,
    paypalCaptureId: null,
    authorizationExpiresAt: null,
    approvedAt: new Date(),
    reauthorizedAt: null,
    voidedAt: null,
    settledAt: null,
    releasedAt: null,
    settlementError: null,
    attempt: 1,
    items,
    payout: null,
  });

  it("follows the room's placement order, leads with the first unchecked item, and offers the policy's choices with amounts", () => {
    const torn = { verdict: "new_damage" as const, damage: tear, confidence: "high" as const, observations: "Tear.", model: "m", attempts: 1, comparedAt: new Date().toISOString() };
    const view = buildHandoffView({
      order: order([item("chair", "marcus", "Marcus Bell", 3_500, { status: "verified", report: torn, photos: [{ src: "/handoff-samples/marcus-mesh-desk-chair-torn.jpg", source: "sample", takenAt: new Date().toISOString() }] }), item("desk", "jun", "Jun Park", 5_500, { decision: "accepted", payCents: 5_500, decidedAt: new Date() })]),
      roomLabel: "Harbor Hall 214",
      buyerFirstName: "Jordan",
      layout,
      events: [],
    });
    expect(view.items.map((entry) => entry.noun)).toEqual(["desk", "chair"]);
    expect(view.nextItemId).toBe("chair");
    const chairView = view.items[1];
    expect(chairView.state).toBe("decide");
    expect(chairView.finding).toBe("Marcus's chair has a new 3 cm tear. You pay $30 of $35.");
    expect(chairView.choices).toEqual([
      { choice: "accept", decision: "adjusted", payCents: 3_000, releasedCents: 500 },
      { choice: "turn_down", decision: "rejected", payCents: 0, releasedCents: 3_500 },
    ]);
    expect(chairView.itemKey).toBe("marcus-mesh-desk-chair");
    expect(view.phase).toBe("checking");
    expect(view.pickup).toEqual({ startsAt: "2026-11-22T00:00:00.000Z", endsAt: "2026-11-25T00:00:00.000Z" });
    expect(view.totals).toEqual({ heldCents: 9_000, agreedCents: 9_000, releasedCents: 0 });
  });

  it("shows a failed comparison and counts the released money once every item is decided", () => {
    const failed = buildHandoffView({ order: order([item("desk", "jun", "Jun Park", 5_500, { verifierError: "The verifier could not read this photo." })]), roomLabel: "Harbor Hall 214", buyerFirstName: "Jordan", layout, events: [] });
    expect(failed.items[0].state).toBe("failed");
    const decided = buildHandoffView({
      order: order([item("desk", "jun", "Jun Park", 5_500, { decision: "accepted", payCents: 5_500, decidedAt: new Date() }), item("chair", "marcus", "Marcus Bell", 3_500, { decision: "adjusted", payCents: 3_000, decidedAt: new Date() })]),
      roomLabel: "Harbor Hall 214",
      buyerFirstName: "Jordan",
      layout,
      events: [],
    });
    expect(decided.nextItemId).toBeNull();
    expect(decided.totals).toEqual({ heldCents: 9_000, agreedCents: 8_500, releasedCents: 500 });
  });
});
