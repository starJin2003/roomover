import { z } from "zod";
import { HANDOFF_DECISIONS, type HandoffMode, type PaymentMode } from "./enums";
import { defectSchema } from "./listing";

/** PayPal keeps an authorization valid for 29 days. */
export const AUTHORIZATION_VALIDITY_DAYS = 29;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MoveWindows {
  moveOutStartsAt: Date;
  moveOutEndsAt: Date;
  moveInStartsAt: Date;
  moveInEndsAt: Date;
}

export function windowsOverlap(windows: MoveWindows): boolean {
  return windows.moveOutStartsAt < windows.moveInEndsAt && windows.moveInStartsAt < windows.moveOutEndsAt;
}

/** Days from the end of move out to the start of move in. Zero or less when the windows overlap. */
export function gapDays(windows: MoveWindows): number {
  return (windows.moveInStartsAt.getTime() - windows.moveOutEndsAt.getTime()) / DAY_MS;
}

/**
 * The payment mode a handoff mode implies for a pair of windows, or null when
 * the handoff mode cannot serve them. A direct handoff needs both students on
 * campus at once. A same room handoff authorizes while the gap fits inside one
 * authorization and captures at checkout after that. A storage hold always
 * captures at checkout.
 */
export function paymentModeFor(mode: HandoffMode, windows: MoveWindows): PaymentMode | null {
  switch (mode) {
    case "direct":
      return windowsOverlap(windows) ? "authorize_then_capture" : null;
    case "same_room":
      return gapDays(windows) <= AUTHORIZATION_VALIDITY_DAYS ? "authorize_then_capture" : "capture_at_checkout";
    case "storage_hold":
      return "capture_at_checkout";
  }
}

export const handoffPhotoSchema = z.strictObject({
  src: z.string().min(1),
  takenAt: z.iso.datetime({ offset: true }),
});

export const handoffPhotosSchema = z.array(handoffPhotoSchema);

/**
 * The verifier's structured comparison of listing and handoff photos. It
 * recommends a decision, and deterministic code turns the decision and the
 * defect severities into amounts.
 */
export const verificationReportSchema = z.strictObject({
  itemPresent: z.boolean(),
  matchesListing: z.boolean(),
  newDefects: z.array(defectSchema),
  recommendedDecision: z.enum(HANDOFF_DECISIONS),
  summary: z.string().min(1),
  model: z.string().min(1),
  comparedAt: z.iso.datetime({ offset: true }),
});

export type HandoffPhoto = z.infer<typeof handoffPhotoSchema>;
export type VerificationReport = z.infer<typeof verificationReportSchema>;
