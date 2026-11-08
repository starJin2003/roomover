import { describe, expect, it } from "vitest";
import { checkoutPaymentMode, handoffWindow, type MoveWindows, type TimeWindow } from "@/lib/domain/handoff";

const windows = (moveOut: [string, string], moveIn: [string, string]): MoveWindows => ({
  moveOutStartsAt: new Date(moveOut[0]),
  moveOutEndsAt: new Date(moveOut[1]),
  moveInStartsAt: new Date(moveIn[0]),
  moveInEndsAt: new Date(moveIn[1]),
});

const span = (startsAt: string, endsAt: string): TimeWindow => ({ startsAt: new Date(startsAt), endsAt: new Date(endsAt) });

const winterMoveIn: [string, string] = ["2026-11-22T09:00:00-06:00", "2026-11-24T18:00:00-06:00"];
const fallMoveOut: [string, string] = ["2026-11-14T08:00:00-06:00", "2026-11-15T12:00:00-06:00"];
const overlapping = windows(["2026-11-17T09:00:00-06:00", "2026-11-25T20:00:00-06:00"], winterMoveIn);
const sequential = windows(fallMoveOut, winterMoveIn);

describe("handoffWindow", () => {
  it("gives a direct handoff the time both students are on campus", () => {
    expect(handoffWindow("direct", overlapping)).toEqual(span("2026-11-22T09:00:00-06:00", "2026-11-24T18:00:00-06:00"));
    const partial = windows(["2026-11-17T09:00:00-06:00", "2026-11-23T12:00:00-06:00"], winterMoveIn);
    expect(handoffWindow("direct", partial)).toEqual(span("2026-11-22T09:00:00-06:00", "2026-11-23T12:00:00-06:00"));
  });

  it("rejects a direct handoff when the seller leaves before the buyer arrives", () => {
    expect(handoffWindow("direct", sequential)).toBeNull();
    const touching = windows(["2026-11-20T09:00:00-06:00", "2026-11-22T09:00:00-06:00"], winterMoveIn);
    expect(handoffWindow("direct", touching)).toBeNull();
  });

  it("hands same room and storage items over during move in once the seller is gone", () => {
    const moveIn = span(...winterMoveIn);
    expect(handoffWindow("same_room", sequential)).toEqual(moveIn);
    expect(handoffWindow("storage_hold", sequential)).toEqual(moveIn);
  });

  it("rejects same room and storage handoffs while the seller is still in the room", () => {
    expect(handoffWindow("same_room", overlapping)).toBeNull();
    expect(handoffWindow("storage_hold", overlapping)).toBeNull();
  });
});

describe("checkoutPaymentMode", () => {
  const checkoutAt = new Date("2026-11-08T12:00:00Z");

  it("authorizes when every handoff ends within 29 days of checkout", () => {
    const handoffs = [span("2026-11-13T12:00:00Z", "2026-11-15T12:00:00Z"), span("2026-11-20T12:00:00Z", "2026-11-28T12:00:00Z")];
    expect(checkoutPaymentMode(checkoutAt, handoffs)).toBe("authorize_then_capture");
  });

  it("counts the 29 days from checkout and includes the last instant", () => {
    const exactly29 = span("2026-12-01T12:00:00Z", "2026-12-07T12:00:00Z");
    expect(checkoutPaymentMode(checkoutAt, [exactly29])).toBe("authorize_then_capture");
    const oneSecondLater = span("2026-12-01T12:00:00Z", "2026-12-07T12:00:01Z");
    expect(checkoutPaymentMode(checkoutAt, [oneSecondLater])).toBe("capture_at_checkout");
  });

  it("captures the whole order at checkout when one handoff ends later", () => {
    const handoffs = [
      span("2026-11-13T12:00:00Z", "2026-11-15T12:00:00Z"),
      span("2026-11-20T12:00:00Z", "2026-11-28T12:00:00Z"),
      span("2027-04-01T14:00:00Z", "2027-04-04T23:00:00Z"),
    ];
    expect(checkoutPaymentMode(checkoutAt, handoffs)).toBe("capture_at_checkout");
  });

  it("measures from checkout, so the same handoff can flip modes as checkout moves", () => {
    const handoff = span("2026-12-20T15:00:00Z", "2026-12-22T00:00:00Z");
    expect(checkoutPaymentMode(new Date("2026-11-20T12:00:00Z"), [handoff])).toBe("capture_at_checkout");
    expect(checkoutPaymentMode(new Date("2026-11-25T12:00:00Z"), [handoff])).toBe("authorize_then_capture");
  });

  it("accepts a handoff window that is already open at checkout", () => {
    expect(checkoutPaymentMode(checkoutAt, [span("2026-11-07T12:00:00Z", "2026-11-09T12:00:00Z")])).toBe(
      "authorize_then_capture",
    );
  });

  it("rejects an empty cart and a handoff that ended before checkout", () => {
    expect(() => checkoutPaymentMode(checkoutAt, [])).toThrow(RangeError);
    expect(() => checkoutPaymentMode(checkoutAt, [span("2026-11-01T12:00:00Z", "2026-11-08T12:00:00Z")])).toThrow(
      RangeError,
    );
  });
});
