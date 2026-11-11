/**
 * The two marks under items in the room. The Sky ring greets an item the
 * agent just placed and fades away, and the selection outline stays only
 * while the student is moving an item.
 */

/** The Sky ring holds this long after the item lands, then fades out. */
export const RING_HOLD_MS = 2000;
const RING_FADE_IN_MS = 220;
const RING_FADE_OUT_MS = 600;

/** How long the ring stays in the room. With reduced motion it shows for the hold and leaves without a fade. */
export function ringLifetimeMs(reducedMotion: boolean): number {
  return reducedMotion ? RING_HOLD_MS : RING_HOLD_MS + RING_FADE_OUT_MS;
}

/** The ring's opacity a given time after it appeared. */
export function ringOpacity(elapsedMs: number, reducedMotion: boolean): number {
  if (elapsedMs >= ringLifetimeMs(reducedMotion)) return 0;
  if (reducedMotion) return 1;
  if (elapsedMs < RING_FADE_IN_MS) return Math.max(0, elapsedMs) / RING_FADE_IN_MS;
  if (elapsedMs <= RING_HOLD_MS) return 1;
  return 1 - (elapsedMs - RING_HOLD_MS) / RING_FADE_OUT_MS;
}

export interface RingState {
  ring: { key: string; id: number } | null;
  nextId: number;
}

export const NO_RING: RingState = { ring: null, nextId: 1 };

export type RingEvent =
  /** `placed` is false for an item that was already in the room when it loaded. */
  | { type: "landed"; key: string; placed: boolean }
  | { type: "expired"; id: number }
  | { type: "cleared" };

/** Each landing gets its own ring ID, so a timer from an earlier ring never clears a later one. */
export function nextRing(state: RingState, event: RingEvent): RingState {
  switch (event.type) {
    case "landed":
      return event.placed ? { ring: { key: event.key, id: state.nextId }, nextId: state.nextId + 1 } : state;
    case "expired":
      return state.ring?.id === event.id ? { ...state, ring: null } : state;
    case "cleared":
      return state.ring === null ? state : { ...state, ring: null };
  }
}

export type SelectionEvent =
  | { type: "select"; key: string }
  | { type: "toggle"; key: string }
  /** A click on the floor or anywhere in the room that holds no item. */
  | { type: "floor" }
  | { type: "escape" }
  /** A dragged item saved at its new spot. */
  | { type: "saved"; key: string }
  | { type: "done" };

/** The item that stays selected after an event, or null once the outline should clear. */
export function selectionAfter(selected: string | null, event: SelectionEvent): string | null {
  switch (event.type) {
    case "select":
      return event.key;
    case "toggle":
      return selected === event.key ? null : event.key;
    case "saved":
      return selected === event.key ? null : selected;
    case "floor":
    case "escape":
    case "done":
      return null;
  }
}
