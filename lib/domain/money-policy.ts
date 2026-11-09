import type { HandoffDecision } from "./enums";
import type { Damage, Verdict } from "./verdict";

/**
 * The handoff money policy. The verifier recommends, the student confirms,
 * and these rules decide how much of each item's price the seller receives.
 * The model never writes an amount.
 *
 * A match pays the full price. Minor new damage pays the price less 15
 * percent, rounded to the nearest whole dollar. Major new damage lets the
 * student keep the item at half price or turn it down. A wrong item, a
 * missing item, and anything the student turns down are released, so
 * PayPal voids or refunds them.
 */

export const MINOR_DAMAGE_PERCENT_OFF = 15;
export const MAJOR_DAMAGE_PERCENT_KEPT = 50;

/** What the student can tap. `keep_half` exists only for major damage. */
export const HANDOFF_CHOICES = ["accept", "keep_half", "turn_down", "not_here"] as const;
export type HandoffChoice = (typeof HANDOFF_CHOICES)[number];

/** What the verifier saw, or `none` when the student reports the item missing without a photo. */
export type Finding = { verdict: Exclude<Verdict, "new_damage"> } | { verdict: "new_damage"; damage: Pick<Damage, "severity"> } | { verdict: "none" };

export interface Settled {
  decision: HandoffDecision;
  /** What the student pays the seller for this item, in cents. */
  payCents: number;
  /** What goes back to the student, in cents. */
  releasedCents: number;
}

/**
 * The price less 15 percent, to the nearest dollar with half dollars
 * rounding up. An item under 59 cents would round to nothing, so it keeps
 * the reduced price to the cent. Never below one cent or above the price.
 */
export function minorDamageCents(priceCents: number): number {
  assertPrice(priceCents);
  // Hundredths of a cent stay integers, so the half dollar test is exact.
  const reduced = priceCents * (100 - MINOR_DAMAGE_PERCENT_OFF);
  const dollars = Math.floor((reduced + 5_000) / 10_000) * 100;
  return Math.min(priceCents, Math.max(1, dollars === 0 ? Math.floor(reduced / 100) : dollars));
}

/** Half the price, with an odd cent going to the student. */
export function majorDamageCents(priceCents: number): number {
  assertPrice(priceCents);
  return Math.max(1, Math.floor((priceCents * MAJOR_DAMAGE_PERCENT_KEPT) / 100));
}

function assertPrice(priceCents: number): void {
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0) throw new RangeError("An item price must be a positive integer number of cents.");
}

/** The choices the student sees for a finding, recommended first. */
export function choicesFor(finding: Finding): readonly HandoffChoice[] {
  switch (finding.verdict) {
    case "match":
      return ["accept", "turn_down"];
    case "new_damage":
      return finding.damage.severity === "minor" ? ["accept", "turn_down"] : ["keep_half", "turn_down"];
    case "wrong_item":
      return ["turn_down", "accept"];
    case "missing":
    case "none":
      return ["not_here"];
  }
}

export class ChoiceRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChoiceRefused";
  }
}

const released = (decision: HandoffDecision, priceCents: number): Settled => ({ decision, payCents: 0, releasedCents: priceCents });

/**
 * Turns a confirmed choice into the decision and the amounts. A wrong item
 * the student accepts anyway pays the full price, since the student judged
 * it to be what they bought.
 */
export function settleChoice(finding: Finding, choice: HandoffChoice, priceCents: number): Settled {
  assertPrice(priceCents);
  if (!choicesFor(finding).includes(choice)) throw new ChoiceRefused(`"${choice}" is not offered for a ${finding.verdict} finding.`);
  switch (choice) {
    case "not_here":
      return released("missing", priceCents);
    case "turn_down":
      return released("rejected", priceCents);
    case "keep_half": {
      const pay = majorDamageCents(priceCents);
      return { decision: "adjusted", payCents: pay, releasedCents: priceCents - pay };
    }
    case "accept": {
      if (finding.verdict === "new_damage") {
        const pay = minorDamageCents(priceCents);
        return { decision: pay === priceCents ? "accepted" : "adjusted", payCents: pay, releasedCents: priceCents - pay };
      }
      return { decision: "accepted", payCents: priceCents, releasedCents: 0 };
    }
  }
}
