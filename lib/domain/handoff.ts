import { z } from "zod";
import type { HandoffMode, PaymentMode } from "./enums";

/** PayPal keeps an authorization valid for 29 days, counted from checkout to capture. */
export const AUTHORIZATION_VALIDITY_DAYS = 29;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TimeWindow {
  startsAt: Date;
  endsAt: Date;
}

export interface MoveWindows {
  moveOutStartsAt: Date;
  moveOutEndsAt: Date;
  moveInStartsAt: Date;
  moveInEndsAt: Date;
}

/**
 * When the buyer can take the item, or null when the handoff mode cannot
 * serve the windows. A direct handoff needs both students on campus at once.
 * Same room and storage hold handoffs need the seller gone before the buyer
 * arrives, and the buyer takes the item during move in.
 */
export function handoffWindow(mode: HandoffMode, windows: MoveWindows): TimeWindow | null {
  switch (mode) {
    case "direct": {
      const startsAt = new Date(Math.max(windows.moveOutStartsAt.getTime(), windows.moveInStartsAt.getTime()));
      const endsAt = new Date(Math.min(windows.moveOutEndsAt.getTime(), windows.moveInEndsAt.getTime()));
      return startsAt < endsAt ? { startsAt, endsAt } : null;
    }
    case "same_room":
    case "storage_hold":
      return windows.moveOutEndsAt <= windows.moveInStartsAt
        ? { startsAt: windows.moveInStartsAt, endsAt: windows.moveInEndsAt }
        : null;
  }
}

/**
 * One order, one approval. The order authorizes at checkout and captures each
 * item at its handoff when every handoff ends within 29 days of checkout. A
 * single later handoff makes the whole order capture at checkout, and items
 * rejected at handoff are refunded. Each window is the item's handoff window,
 * or its agreed slot once the buyer and seller have one.
 */
export function checkoutPaymentMode(checkoutAt: Date, handoffs: readonly TimeWindow[]): PaymentMode {
  if (handoffs.length === 0) throw new RangeError("A checkout needs at least one item.");
  if (handoffs.some((handoff) => handoff.endsAt <= checkoutAt)) {
    throw new RangeError("Every handoff window must end after checkout.");
  }
  const latestEnd = Math.max(...handoffs.map((handoff) => handoff.endsAt.getTime()));
  return latestEnd - checkoutAt.getTime() <= AUTHORIZATION_VALIDITY_DAYS * DAY_MS
    ? "authorize_then_capture"
    : "capture_at_checkout";
}

/** A sample photo committed under the public folder, or an upload Roomover serves to the session that took it. */
export const HANDOFF_PHOTO_SRC = /^\/(handoff-samples\/[a-z0-9-]+\.jpg|api\/handoff\/photos\/[0-9a-f-]{36})$/;

export const handoffPhotoSchema = z.strictObject({
  src: z.string().regex(HANDOFF_PHOTO_SRC),
  source: z.enum(["upload", "sample"]),
  takenAt: z.iso.datetime({ offset: true }),
});

export const handoffPhotosSchema = z.array(handoffPhotoSchema);

export type HandoffPhoto = z.infer<typeof handoffPhotoSchema>;
