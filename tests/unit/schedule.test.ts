import { describe, expect, it } from "vitest";
import type { HandoffItem, HandoffOrder } from "@/lib/db/handoffs";
import type { HandoffMode } from "@/lib/domain/enums";
import type { HandoffPhoto, TimeWindow } from "@/lib/domain/handoff";
import { campusInstant, slotFor } from "@/lib/domain/handoff-slots";
import { buildSchedule, checkSlotMove, listWords, STUDENT_ROW, type ScheduleInput, type ScheduleItem } from "@/lib/domain/schedule";
import { scheduleOf } from "@/lib/handoff/schedule";

/** The Harbor Hall 214 calendar from a seed on Mon, Nov 9, in campus time. */
const window = (from: [string, number], to: [string, number]): TimeWindow => ({ startsAt: campusInstant(...from), endsAt: campusInstant(...to) });
const FALL_MOVE_OUT = window(["2026-11-15", 8], ["2026-11-16", 12]);
const WINTER_MOVE_IN = window(["2026-11-23", 9], ["2026-11-25", 18]);
const JUN_OUT = window(["2026-11-16", 9], ["2026-11-25", 20]);
const MARCUS_OUT = window(["2026-11-19", 10], ["2026-11-29", 20]);
const NOW = campusInstant("2026-11-20", 12);

function item(id: string, seller: string, noun: string, mode: HandoffMode, moveOut: TimeWindow, slot: TimeWindow, waiting = true): ScheduleItem {
  return { orderItemId: id, sellerId: seller.toLowerCase(), sellerName: `${seller} ${seller === "Jun" ? "Park" : "Smith"}`, noun, handoffMode: mode, moveOut, moveIn: WINTER_MOVE_IN, slot, waiting };
}

const harbor = (overrides: Partial<ScheduleInput> = {}): ScheduleInput => ({
  buyerFirstName: "Jordan",
  roomLabel: "Harbor Hall 214",
  open: true,
  holdEndsAt: campusInstant("2026-12-08", 12),
  items: [
    item("desk", "Jun", "desk", "direct", JUN_OUT, slotFor({ day: "2026-11-23", startHour: 14 })),
    item("chair", "Marcus", "chair", "direct", MARCUS_OUT, slotFor({ day: "2026-11-24", startHour: 16 })),
    item("clamp", "Sofia", "clamp lamp", "same_room", FALL_MOVE_OUT, slotFor({ day: "2026-11-23", startHour: 10 })),
    item("beanbag", "Lea", "bean bag", "same_room", FALL_MOVE_OUT, slotFor({ day: "2026-11-23", startHour: 12 })),
  ],
  ...overrides,
});

describe("buildSchedule", () => {
  it("gives each seller a row in checklist order and the student the last row", () => {
    const schedule = buildSchedule(harbor());
    expect(schedule.resources.map((row) => [row.id, row.kind, row.name, row.detail])).toEqual([
      ["jun", "seller", "Jun Park", "desk"],
      ["marcus", "seller", "Marcus Smith", "chair"],
      ["sofia", "seller", "Sofia Smith", "clamp lamp"],
      ["lea", "seller", "Lea Smith", "bean bag"],
      [STUDENT_ROW, "student", "Jordan", "moves in"],
    ]);
  });

  it("draws each move out, the time a same room item waits, and the student's move in", () => {
    const schedule = buildSchedule(harbor());
    const kinds = schedule.ranges.map((range) => [range.resourceId, range.kind]);
    expect(kinds).toEqual([
      ["jun", "move_out"],
      ["marcus", "move_out"],
      ["sofia", "move_out"],
      ["lea", "move_out"],
      ["sofia", "room"],
      ["lea", "room"],
      [STUDENT_ROW, "move_in"],
    ]);
    const sofiaWaits = schedule.ranges.find((range) => range.resourceId === "sofia" && range.kind === "room");
    expect(sofiaWaits).toMatchObject({ label: "Waits in Harbor Hall 214", startsAt: FALL_MOVE_OUT.endsAt.toISOString(), endsAt: campusInstant("2026-11-23", 10).toISOString() });
    expect(schedule.moveIn).toEqual({ startsAt: WINTER_MOVE_IN.startsAt.toISOString(), endsAt: WINTER_MOVE_IN.endsAt.toISOString() });
    expect(schedule.span).toEqual({ startsAt: campusInstant("2026-11-15", 0).toISOString(), endsAt: campusInstant("2026-11-30", 0).toISOString() });
  });

  it("marks storage holds and words the gap with real names and days", () => {
    const stored = harbor({
      items: [item("lamp", "Ava", "lamp", "storage_hold", FALL_MOVE_OUT, slotFor({ day: "2026-11-24", startHour: 12 }))],
    });
    const schedule = buildSchedule(stored);
    expect(schedule.ranges.find((range) => range.kind === "storage")).toMatchObject({ resourceId: "ava", label: "In campus storage" });
    expect(schedule.summary).toBe("Ava leaves by Mon, Nov 16, 7 days before Jordan arrives, so Roomover keeps the item in campus storage until the handoff.");
    expect(buildSchedule(harbor()).summary).toBe("Sofia and Lea leave by Mon, Nov 16, 7 days before Jordan arrives, so Roomover keeps their items in Harbor Hall 214 until the handoff.");
    const direct = harbor({ items: harbor().items.slice(0, 2) });
    expect(buildSchedule(direct).summary).toBe("Every seller is still on campus when Jordan arrives on Mon, Nov 23, so each handoff happens in person.");
  });

  it("joins one seller's items with one slot into one handoff, as a bundle was agreed", () => {
    const slot = slotFor({ day: "2026-11-24", startHour: 12 });
    const schedule = buildSchedule(harbor({ items: [item("rug", "Jun", "rug", "direct", JUN_OUT, slot), item("chair2", "Jun", "chair", "direct", JUN_OUT, slot)] }));
    expect(schedule.slots).toHaveLength(1);
    expect(schedule.slots[0]).toMatchObject({ orderItemIds: ["rug", "chair2"], nouns: "rug and chair", sellerFirstName: "Jun", label: "Tue, Nov 24, noon to 2 PM", agreed: true, movable: true });
    expect(schedule.resources[0].detail).toBe("rug and chair");
    expect(listWords(["lamp", "cart", "rug"])).toBe("lamp, cart, and rug");
  });

  it("keeps a slot in place once its handoff starts, when the order is closed, or when no slot was agreed", () => {
    const started = harbor({ items: [item("desk", "Jun", "desk", "direct", JUN_OUT, slotFor({ day: "2026-11-23", startHour: 14 }), false)] });
    expect(buildSchedule(started).slots[0].movable).toBe(false);
    expect(buildSchedule(harbor({ open: false })).slots.every((slot) => !slot.movable)).toBe(true);
    const whole = harbor({ items: [item("desk", "Jun", "desk", "direct", JUN_OUT, { startsAt: WINTER_MOVE_IN.startsAt, endsAt: WINTER_MOVE_IN.endsAt })] });
    expect(buildSchedule(whole).slots[0]).toMatchObject({ agreed: false, movable: false, label: "Any time Mon, Nov 23, 9 AM to Wed, Nov 25, 6 PM" });
  });

  it("limits a direct handoff to the seller's move out and a same room handoff to the student's move in", () => {
    const [jun, , sofia] = buildSchedule(harbor()).slots;
    expect(jun.limits?.moveOut).toEqual({ startsAt: JUN_OUT.startsAt.toISOString(), endsAt: JUN_OUT.endsAt.toISOString() });
    expect(sofia.limits?.moveOut).toBeNull();
    expect(sofia.limits?.holdEndsAt).toBe(campusInstant("2026-12-08", 12).toISOString());
  });
});

describe("checkSlotMove", () => {
  const context = { now: NOW, buyerFirstName: "Jordan" };
  const [jun, , sofia] = buildSchedule(harbor()).slots;
  const at = (day: string, hour: number) => campusInstant(day, hour);

  it("accepts two hours on a slot hour inside both windows and says where the handoff went", () => {
    const check = checkSlotMove(jun, at("2026-11-24", 10), context);
    expect(check).toEqual({ ok: true, slot: slotFor({ day: "2026-11-24", startHour: 10 }), sentence: "Moved Jun's handoff to Tue, Nov 24, 10 AM to noon." });
    expect(checkSlotMove(sofia, at("2026-11-25", 16), context)).toMatchObject({ ok: true, sentence: "Moved Sofia's handoff to Wed, Nov 25, 4 to 6 PM." });
  });

  it("refuses a slot off the slot hours, in the past, or outside the student's move in", () => {
    expect(checkSlotMove(jun, at("2026-11-24", 11), context)).toEqual({ ok: false, sentence: "Handoffs take two hours and start at 10 AM, noon, 2 PM, 4 PM, or 6 PM." });
    expect(checkSlotMove(jun, at("2026-11-24", 10), { ...context, now: at("2026-11-24", 11) })).toEqual({ ok: false, sentence: "That time has passed, so pick a later slot." });
    expect(checkSlotMove(jun, at("2026-11-22", 14), context)).toEqual({ ok: false, sentence: "Jordan moves in from Mon, Nov 23, 9 AM, so the handoff cannot be earlier." });
    expect(checkSlotMove(jun, at("2026-11-25", 18), context)).toEqual({ ok: false, sentence: "Jordan's move in ends Wed, Nov 25, 6 PM, so the handoff cannot be later." });
  });

  it("refuses a direct handoff after the seller leaves and any handoff after PayPal's hold ends", () => {
    const leaving = item("desk", "Jun", "desk", "direct", window(["2026-11-16", 9], ["2026-11-24", 20]), slotFor({ day: "2026-11-23", startHour: 14 }));
    const [early] = buildSchedule(harbor({ items: [leaving] })).slots;
    expect(checkSlotMove(early, at("2026-11-25", 10), context)).toEqual({ ok: false, sentence: "Jun moves out by Tue, Nov 24, 8 PM, so the handoff has to be earlier." });
    const [held] = buildSchedule(harbor({ holdEndsAt: at("2026-11-24", 12) })).slots;
    expect(checkSlotMove(held, at("2026-11-24", 12), context)).toEqual({ ok: false, sentence: "PayPal holds the payment until Tue, Nov 24, noon, so the handoff has to end by then." });
    expect(checkSlotMove(held, at("2026-11-24", 10), context).ok).toBe(true);
  });

  it("refuses to move a handoff that has started", () => {
    expect(checkSlotMove({ ...jun, movable: false }, at("2026-11-24", 10), context)).toEqual({ ok: false, sentence: "Jun's handoff has started, so its slot stays." });
  });
});

describe("scheduleOf", () => {
  const harborItem = (id: string, seller: string, mode: HandoffMode, moveOut: TimeWindow, slot: TimeWindow, photos: HandoffPhoto[] = []): HandoffItem => ({
    orderItemId: id,
    listingId: `listing-${id}`,
    sellerId: seller.toLowerCase(),
    sellerName: `${seller} Park`,
    title: `Listing ${id}`,
    description: "",
    widthMm: 1,
    depthMm: 1,
    heightMm: 1,
    conditionReport: { grade: "good", notes: "Fine", defects: [], assessedBy: "seller" },
    photos: [{ src: "/seed/listings/jun-white-desk.jpg", alt: id, widthPx: 1, heightPx: 1 }],
    listingStatus: "reserved",
    handoffMode: mode,
    moveOutStartsAt: moveOut.startsAt,
    moveOutEndsAt: moveOut.endsAt,
    moveInStartsAt: WINTER_MOVE_IN.startsAt,
    moveInEndsAt: WINTER_MOVE_IN.endsAt,
    amountCents: 2_000,
    capturedAmountCents: 0,
    refundedAmountCents: 0,
    status: "authorized",
    paypalCaptureId: null,
    paypalRefundId: null,
    slot,
    attempt: 1,
    handoff: { id: `h-${id}`, mode, status: "scheduled", slotStartsAt: slot.startsAt, slotEndsAt: slot.endsAt, location: "Harbor Hall 214", photos, report: null, verifierError: null, decision: null, payCents: null, decidedAt: null },
  });
  const order = (overrides: Partial<HandoffOrder> = {}): HandoffOrder => ({
    id: "order-1",
    planId: "plan-1",
    sessionId: "s",
    paymentMode: "authorize_then_capture",
    status: "authorized",
    totalCents: 4_000,
    paypalOrderId: "ORDER",
    paypalAuthorizationId: "AUTH",
    paypalReauthorizationId: null,
    paypalCaptureId: null,
    authorizationExpiresAt: null,
    approvedAt: campusInstant("2026-11-09", 12),
    reauthorizedAt: null,
    voidedAt: null,
    settledAt: null,
    releasedAt: null,
    settlementError: null,
    attempt: 1,
    items: [
      harborItem("lamp", "Sofia", "same_room", FALL_MOVE_OUT, slotFor({ day: "2026-11-23", startHour: 10 })),
      harborItem("desk", "Jun", "direct", JUN_OUT, slotFor({ day: "2026-11-23", startHour: 14 })),
    ],
    payout: null,
    ...overrides,
  });
  const words = { nouns: new Map([["desk", "desk"], ["lamp", "clamp lamp"]]), order: ["desk", "lamp"], buyerFirstName: "Jordan", roomLabel: "Harbor Hall 214" };

  it("reads each handoff row's slot, follows the checklist order, and holds slots to PayPal's 29 day authorization", () => {
    const schedule = scheduleOf(order(), words);
    expect(schedule.resources.map((row) => row.name)).toEqual(["Jun Park", "Sofia Park", "Jordan"]);
    expect(schedule.slots.map((slot) => [slot.nouns, slot.label, slot.movable])).toEqual([
      ["desk", "Mon, Nov 23, 2 to 4 PM", true],
      ["clamp lamp", "Mon, Nov 23, 10 AM to noon", true],
    ]);
    expect(schedule.slots[0].limits?.holdEndsAt).toBe(campusInstant("2026-12-08", 12).toISOString());
    const expiring = scheduleOf(order({ authorizationExpiresAt: campusInstant("2026-12-01", 9) }), words);
    expect(expiring.slots[0].limits?.holdEndsAt).toBe(campusInstant("2026-12-01", 9).toISOString());
  });

  it("frees capture mode orders from the hold, fixes a started handoff, and fixes every slot once the order settles", () => {
    expect(scheduleOf(order({ paymentMode: "capture_at_checkout", status: "captured" }), words).slots[0].limits?.holdEndsAt).toBeNull();
    const photo = { src: "/handoff-samples/jun-white-desk.jpg", source: "sample" as const, takenAt: new Date().toISOString() };
    const started = order({ items: [harborItem("desk", "Jun", "direct", JUN_OUT, slotFor({ day: "2026-11-23", startHour: 14 }), [photo])] });
    expect(scheduleOf(started, words).slots[0].movable).toBe(false);
    expect(scheduleOf(order({ status: "settled" }), words).slots.every((slot) => !slot.movable)).toBe(true);
  });
});
