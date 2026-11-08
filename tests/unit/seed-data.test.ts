import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LISTING_CATEGORIES, HANDOFF_MODES } from "@/lib/domain/enums";
import { checkoutPaymentMode, handoffWindow, type MoveWindows } from "@/lib/domain/handoff";
import { hallConstraintsSchema } from "@/lib/domain/hall-rules";
import {
  conditionReportSchema,
  listingPhotosSchema,
  listingSpecsSchema,
  retailReferenceSchema,
} from "@/lib/domain/listing";
import { geometryProblems, roomGeometrySchema } from "@/lib/domain/room";
import { buildSeed } from "@/scripts/seed";
import { SANDBOX_EMAILS } from "@/scripts/seed/people";

const SEED_DAY = "2026-11-08";
const SEED_INSTANT = new Date("2026-11-08T06:00:00Z");
const seed = buildSeed(SEED_DAY);
const PUBLIC_DIR = path.join(process.cwd(), "public");
const CREDITS = readFileSync(path.join(PUBLIC_DIR, "seed", "listings", "CREDITS.md"), "utf8");

const windowsOf = (listing: (typeof seed.listings)[number]): MoveWindows => ({
  moveOutStartsAt: listing.moveOutStartsAt,
  moveOutEndsAt: listing.moveOutEndsAt,
  moveInStartsAt: listing.moveInStartsAt,
  moveInEndsAt: listing.moveInEndsAt,
});

/** Width and height from the first start of frame marker of a JPEG file. */
function jpegSize(file: Buffer): { width: number; height: number } {
  expect(file.readUInt16BE(0)).toBe(0xffd8);
  let offset = 2;
  while (offset < file.length) {
    const marker = file.readUInt16BE(offset);
    const length = file.readUInt16BE(offset + 2);
    if (marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker)) {
      return { height: file.readUInt16BE(offset + 5), width: file.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error("No start of frame marker found.");
}

describe("seed JSONB columns", () => {
  it.each(seed.roomPresets.map((preset) => [preset.slug, preset] as const))(
    "room preset %s has valid geometry inside its walls",
    (_slug, preset) => {
      const geometry = roomGeometrySchema.parse(preset.geometry);
      expect(geometryProblems(geometry, preset)).toEqual([]);
    },
  );

  it.each(seed.hallRules.map((rules) => [rules.title, rules] as const))("%s has valid constraints", (_title, rules) => {
    const constraints = hallConstraintsSchema.parse(rules.constraints);
    for (const constraint of constraints) {
      expect(rules.ruleText).toContain(`${constraint.section} `);
    }
  });

  it.each(seed.listings.map((listing) => [listing.title, listing] as const))("%s has valid JSONB", (_title, listing) => {
    expect(listingPhotosSchema.parse(listing.photos)).toHaveLength(listing.photos?.length ?? 0);
    conditionReportSchema.parse(listing.conditionReport);
    retailReferenceSchema.parse(listing.retailReference);
    listingSpecsSchema.parse(listing.specs);
  });
});

describe("seed money and dimensions", () => {
  it("stores every price as integer cents with the floor at or below the price", () => {
    for (const listing of seed.listings) {
      expect(Number.isSafeInteger(listing.priceCents)).toBe(true);
      expect(Number.isSafeInteger(listing.floorPriceCents)).toBe(true);
      expect(listing.priceCents).toBeGreaterThan(0);
      expect(listing.floorPriceCents).toBeGreaterThan(0);
      expect(listing.floorPriceCents).toBeLessThanOrEqual(listing.priceCents);
      expect(listing.priceCents).toBeLessThan(listing.retailReference.newPriceCents);
    }
  });

  it("stores every dimension as positive integer millimeters", () => {
    const sizes = [
      ...seed.listings.map((listing) => [listing.widthMm, listing.depthMm, listing.heightMm]),
      ...seed.roomPresets.map((preset) => [preset.widthMm, preset.depthMm, preset.ceilingHeightMm]),
    ];
    for (const value of sizes.flat()) {
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });

  it("lets a winter cart with one item from each seller land between 30 and 1,500 dollars", () => {
    const winter = seed.listings.filter((listing) => {
      const handoff = handoffWindow(listing.handoffMode, windowsOf(listing));
      return listing.status === "active" && handoff !== null && checkoutPaymentMode(SEED_INSTANT, [handoff]) === "authorize_then_capture";
    });
    const sellers = new Set(winter.map((listing) => listing.sellerId));
    expect(sellers.size).toBe(5);
    const cheapest = [...sellers].map((seller) =>
      Math.min(...winter.filter((listing) => listing.sellerId === seller).map((listing) => listing.priceCents)),
    );
    const everything = winter.reduce((sum, listing) => sum + listing.priceCents, 0);
    expect(cheapest.reduce((sum, price) => sum + price, 0)).toBeGreaterThanOrEqual(3_000);
    expect(everything).toBeLessThanOrEqual(150_000);
  });
});

describe("seed catalog", () => {
  it("has at least 20 listings across five sellers and every category", () => {
    expect(seed.listings.length).toBeGreaterThanOrEqual(20);
    expect(new Set(seed.listings.map((listing) => listing.sellerId)).size).toBe(5);
    expect(new Set(seed.listings.map((listing) => listing.category))).toEqual(new Set(LISTING_CATEGORIES));
  });

  it("exercises every handoff mode with windows that mode can serve", () => {
    expect(new Set(seed.listings.map((listing) => listing.handoffMode))).toEqual(new Set(HANDOFF_MODES));
    for (const listing of seed.listings) {
      const handoff = handoffWindow(listing.handoffMode, windowsOf(listing));
      expect(handoff).not.toBeNull();
      if (handoff === null) continue;
      const mode = checkoutPaymentMode(SEED_INSTANT, [handoff]);
      expect(mode).toBe(listing.handoffMode === "storage_hold" ? "capture_at_checkout" : "authorize_then_capture");
    }
  });

  it("keeps same room listings in the room the judge buyer moves into", () => {
    const judge = seed.users.find((user) => user.paypalEmail === SANDBOX_EMAILS.judgeBuyer);
    const sameRoom = seed.listings.filter((listing) => listing.handoffMode === "same_room");
    expect(sameRoom.length).toBeGreaterThan(0);
    for (const listing of sameRoom) {
      expect([listing.roomPresetId, listing.roomNumber]).toEqual([judge?.roomPresetId, judge?.roomNumber]);
    }
  });
});

describe("seed photos", () => {
  const files = seed.listings.flatMap((listing) => listing.photos.map((photo) => [listing.title, photo] as const));

  it.each(files)("%s has its photo on disk at the stated size", (_title, photo) => {
    const size = jpegSize(readFileSync(path.join(PUBLIC_DIR, photo.src)));
    expect(size).toEqual({ width: photo.widthPx, height: photo.heightPx });
  });

  it.each(files)("%s has a CC0 credit", (_title, photo) => {
    const row = CREDITS.split("\n").find((line) => line.startsWith(`| ${path.basename(photo.src)} |`));
    expect(row).toBeDefined();
    expect(row).toMatch(/\| https:\/\/\S+ \|/);
    expect(row).toContain("CC0 1.0");
  });

  it("uses each photo once", () => {
    const sources = files.map(([, photo]) => photo.src);
    expect(new Set(sources).size).toBe(sources.length);
  });
});

describe("seed people", () => {
  it("maps each of the five sellers to a different sandbox personal account paid through PayPal", () => {
    const sellers = seed.users.filter((user) => user.role === "seller");
    expect(sellers).toHaveLength(5);
    expect(sellers.map((seller) => seller.paypalEmail).sort()).toEqual([...SANDBOX_EMAILS.sellers].sort());
    for (const seller of sellers) {
      expect(seller.paypalEmail).toMatch(/@personal\.example\.com$/);
      expect(seller.payoutWallet).toBe("paypal");
      expect(seller.leavingReason).not.toBeNull();
    }
    expect(new Set(sellers.map((seller) => seller.leavingReason)).size).toBe(5);
  });

  it("maps the judge buyer and the platform to their sandbox accounts", () => {
    expect(seed.users.find((user) => user.role === "buyer")?.paypalEmail).toBe(SANDBOX_EMAILS.judgeBuyer);
    expect(seed.users.find((user) => user.role === "platform")?.paypalEmail).toBe(SANDBOX_EMAILS.platform);
  });
});
