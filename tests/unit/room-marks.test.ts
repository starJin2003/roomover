import { describe, expect, it } from "vitest";
import { NO_RING, nextRing, RING_HOLD_MS, ringLifetimeMs, ringOpacity, selectionAfter, type RingEvent, type RingState } from "@/components/room/marks";

const run = (events: RingEvent[], start: RingState = NO_RING) => events.reduce(nextRing, start);

describe("the Sky ring under a placed item", () => {
  it("appears when the agent places an item and moves to each later one", () => {
    const first = run([{ type: "landed", key: "desk", placed: true }]);
    expect(first.ring).toEqual({ key: "desk", id: 1 });
    expect(run([{ type: "landed", key: "lamp", placed: true }], first).ring).toEqual({ key: "lamp", id: 2 });
  });

  it("is absent when a saved plan loads, since its items were already in the room", () => {
    expect(run([{ type: "landed", key: "desk", placed: false }, { type: "landed", key: "lamp", placed: false }]).ring).toBeNull();
  });

  it("clears when its own timer runs out, and an older timer leaves a newer ring alone", () => {
    const desk = run([{ type: "landed", key: "desk", placed: true }]);
    expect(run([{ type: "expired", id: 1 }], desk).ring).toBeNull();
    const lamp = run([{ type: "landed", key: "lamp", placed: true }], desk);
    expect(run([{ type: "expired", id: 1 }], lamp).ring).toEqual({ key: "lamp", id: 2 });
    expect(run([{ type: "cleared" }], lamp).ring).toBeNull();
  });

  it("holds about 2 seconds and then fades out, or with reduced motion shows whole and leaves without a fade", () => {
    expect(ringOpacity(0, false)).toBe(0);
    expect(ringOpacity(110, false)).toBeCloseTo(0.5);
    expect(ringOpacity(RING_HOLD_MS, false)).toBe(1);
    expect(ringOpacity(RING_HOLD_MS + 300, false)).toBeCloseTo(0.5);
    expect(ringOpacity(ringLifetimeMs(false), false)).toBe(0);
    expect(ringLifetimeMs(false)).toBe(2_600);

    expect(ringOpacity(0, true)).toBe(1);
    expect(ringOpacity(RING_HOLD_MS - 1, true)).toBe(1);
    expect(ringOpacity(RING_HOLD_MS, true)).toBe(0);
    expect(ringLifetimeMs(true)).toBe(RING_HOLD_MS);
  });
});

describe("the selection outline", () => {
  it("shows on the item the student picks up and moves to another item picked next", () => {
    expect(selectionAfter(null, { type: "select", key: "bean-bag" })).toBe("bean-bag");
    expect(selectionAfter("bean-bag", { type: "select", key: "desk" })).toBe("desk");
    expect(selectionAfter("bean-bag", { type: "toggle", key: "bean-bag" })).toBeNull();
  });

  it("clears on a click on the empty floor, on Escape, on Done, and after the dragged item saves", () => {
    for (const event of [{ type: "floor" }, { type: "escape" }, { type: "done" }, { type: "saved", key: "bean-bag" }] as const) expect(selectionAfter("bean-bag", event), event.type).toBeNull();
    expect(selectionAfter("desk", { type: "saved", key: "bean-bag" })).toBe("desk");
  });
});
