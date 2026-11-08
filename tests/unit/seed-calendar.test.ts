import { describe, expect, it } from "vitest";
import { checkoutPaymentMode, handoffWindow, type TimeWindow } from "@/lib/domain/handoff";
import { buildSeed } from "@/scripts/seed";
import { campusCalendar, campusDay, campusTime, type CampusDay } from "@/scripts/seed/campus";

const DAY_MS = 24 * 60 * 60 * 1000;

function campusDays(first: CampusDay, count: number): CampusDay[] {
  return Array.from({ length: count }, (_, index) => campusDay(new Date(campusTime(first, index, "12:00"))));
}

/** Every seed day from the video recording in November 2026 through the end of 2027. */
const RESEED_DAYS = campusDays("2026-11-01", 426);

function handoffsFor(seedDay: CampusDay) {
  return buildSeed(seedDay).listings.map((listing) => ({
    listing,
    handoff: handoffWindow(listing.handoffMode, {
      moveOutStartsAt: listing.moveOutStartsAt,
      moveOutEndsAt: listing.moveOutEndsAt,
      moveInStartsAt: listing.moveInStartsAt,
      moveInEndsAt: listing.moveInEndsAt,
    }),
  }));
}

const within = (handoff: TimeWindow, from: Date, to: Date) => handoff.startsAt >= from && handoff.endsAt <= to;

describe("campus time", () => {
  it("reads the calendar day in Central Time", () => {
    expect(campusDay(new Date("2026-11-09T05:59:00Z"))).toBe("2026-11-08");
    expect(campusDay(new Date("2026-11-09T06:00:00Z"))).toBe("2026-11-09");
    expect(campusDay(new Date("2027-07-01T04:59:00Z"))).toBe("2027-06-30");
  });

  it("turns a campus wall clock time into the right instant in standard and daylight time", () => {
    expect(campusTime("2026-11-08", 0, "09:00")).toEqual(new Date("2026-11-08T09:00:00-06:00"));
    expect(campusTime("2026-11-08", 160, "09:00")).toEqual(new Date("2027-04-17T09:00:00-05:00"));
    expect(campusTime("2026-12-30", 3, "18:00")).toEqual(new Date("2027-01-02T18:00:00-06:00"));
  });

  it("handles the days daylight saving time starts and ends", () => {
    expect(campusTime("2027-03-13", 1, "08:00")).toEqual(new Date("2027-03-14T08:00:00-05:00"));
    expect(campusTime("2027-03-13", 1, "00:00")).toEqual(new Date("2027-03-14T00:00:00-06:00"));
    expect(campusTime("2026-10-31", 1, "08:00")).toEqual(new Date("2026-11-01T08:00:00-06:00"));
  });

  it("rejects malformed days and times", () => {
    expect(() => campusTime("2026-11-8", 0, "09:00")).toThrow(RangeError);
    expect(() => campusTime("2026-11-08", 0, "9am")).toThrow(RangeError);
  });

  it("lists consecutive campus days across both daylight saving switches", () => {
    expect(RESEED_DAYS).toHaveLength(426);
    expect(new Set(RESEED_DAYS).size).toBe(426);
    expect(RESEED_DAYS.at(0)).toBe("2026-11-01");
    expect(RESEED_DAYS.at(-1)).toBe("2027-12-31");
  });
});

describe("relative seed calendar", () => {
  it("keeps the narrative order after the seed day", () => {
    const calendar = campusCalendar("2026-11-08");
    const seedStart = campusTime("2026-11-08", 0, "00:00");
    expect(seedStart < calendar.fallMoveOut.startsAt).toBe(true);
    expect(calendar.fallMoveOut.endsAt < calendar.winterMoveIn.startsAt).toBe(true);
    expect(calendar.winterMoveIn.endsAt < calendar.springMoveOut.startsAt).toBe(true);
    expect(calendar.springMoveOut.endsAt < calendar.fallMoveIn.startsAt).toBe(true);
  });

  it("writes identical rows for two runs on the same campus day", () => {
    expect(buildSeed("2026-11-08")).toEqual(buildSeed("2026-11-08"));
    expect(buildSeed("2026-11-09").listings[0]?.moveInStartsAt).not.toEqual(buildSeed("2026-11-08").listings[0]?.moveInStartsAt);
  });

  it("offers a five seller cart with every handoff 5 to 20 days out that authorizes, on every reseed day", () => {
    const failures = RESEED_DAYS.filter((seedDay) => {
      const seedStart = campusTime(seedDay, 0, "00:00");
      const lastCheckout = new Date(campusTime(seedDay, 1, "00:00").getTime() - 1);
      const from = new Date(seedStart.getTime() + 5 * DAY_MS);
      const to = new Date(seedStart.getTime() + 20 * DAY_MS);

      const cart = new Map<string, TimeWindow>();
      for (const { listing, handoff } of handoffsFor(seedDay)) {
        if (handoff !== null && listing.status === "active" && within(handoff, from, to)) cart.set(listing.sellerId, handoff);
      }
      const handoffs = [...cart.values()];
      return !(
        cart.size === 5 &&
        checkoutPaymentMode(seedStart, handoffs) === "authorize_then_capture" &&
        checkoutPaymentMode(lastCheckout, handoffs) === "authorize_then_capture"
      );
    });
    expect(failures).toEqual([]);
  });

  it("offers storage carts that capture at checkout and hand over within 180 days, on every reseed day", () => {
    const failures = RESEED_DAYS.filter((seedDay) => {
      const seedStart = campusTime(seedDay, 0, "00:00");
      const storage = handoffsFor(seedDay).filter(({ listing }) => listing.handoffMode === "storage_hold");
      return !(
        storage.length > 0 &&
        storage.every(
          ({ handoff }) =>
            handoff !== null &&
            checkoutPaymentMode(seedStart, [handoff]) === "capture_at_checkout" &&
            handoff.endsAt.getTime() - seedStart.getTime() < 180 * DAY_MS,
        )
      );
    });
    expect(failures).toEqual([]);
  });

  it("captures a mixed winter and storage cart at checkout", () => {
    const seedStart = campusTime("2026-11-08", 0, "00:00");
    const handoffs = handoffsFor("2026-11-08").flatMap(({ handoff }) => (handoff === null ? [] : [handoff]));
    expect(checkoutPaymentMode(seedStart, handoffs)).toBe("capture_at_checkout");
  });
});
