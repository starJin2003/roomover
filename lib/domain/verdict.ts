import { z } from "zod";

/**
 * What the verifier agent reports after it compares the seller's listing
 * photos with the student's handoff photo. The verdict is advisory. The
 * student confirms every decision, and code turns the confirmed decision
 * into an amount.
 */

export const VERDICTS = ["match", "new_damage", "wrong_item", "missing"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const DAMAGE_SEVERITIES = ["minor", "major"] as const;
export type DamageSeverity = (typeof DAMAGE_SEVERITIES)[number];

/** Nouns that read after "a new", as in "has a new 3 cm tear". A break covers broken and missing parts. */
export const DAMAGE_KINDS = ["scratch", "scuff", "dent", "tear", "hole", "stain", "crack", "chip", "burn", "break"] as const;
export type DamageKind = (typeof DAMAGE_KINDS)[number];

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;

export const damageSchema = z.strictObject({
  kind: z.enum(DAMAGE_KINDS),
  /** Where on the item, in a few words, such as "seat cushion" or "left armrest". */
  location: z.string().trim().min(2).max(40),
  /** The longest side of the damage, estimated from the photo. */
  sizeCm: z.number().min(0.5).max(300).nullable(),
  severity: z.enum(DAMAGE_SEVERITIES),
});

/** The shape the model fills through the compare_photos tool. */
export const verdictInputSchema = z.strictObject({
  verdict: z.enum(VERDICTS),
  damage: damageSchema.nullable(),
  confidence: z.enum(CONFIDENCE_LEVELS),
  /** The model's own short account, shown only in the activity details. */
  observations: z.string().trim().min(1).max(500),
});

export const verdictSchema = verdictInputSchema.superRefine((value, context) => {
  if (value.verdict === "new_damage" && value.damage === null) {
    context.addIssue({ code: "custom", path: ["damage"], message: "A new_damage verdict needs the damage object." });
  }
  if (value.verdict !== "new_damage" && value.damage !== null) {
    context.addIssue({ code: "custom", path: ["damage"], message: "Only a new_damage verdict carries a damage object. Set damage to null." });
  }
});

export type VerdictInput = z.infer<typeof verdictInputSchema>;
export type Damage = z.infer<typeof damageSchema>;

/** The verifier's verdict as stored on the handoff, with the call that produced it. */
export const verificationReportSchema = z.strictObject({
  verdict: z.enum(VERDICTS),
  damage: damageSchema.nullable(),
  confidence: z.enum(CONFIDENCE_LEVELS),
  observations: z.string().min(1),
  model: z.string().min(1),
  attempts: z.number().int().min(1).max(2),
  comparedAt: z.iso.datetime({ offset: true }),
});

export type VerificationReport = z.infer<typeof verificationReportSchema>;

/** "3 cm tear" or "scratch", rounded to a whole centimeter from 2 cm up. */
export function damageWords(damage: Damage): string {
  if (damage.sizeCm === null) return damage.kind;
  const size = damage.sizeCm >= 2 ? Math.round(damage.sizeCm) : Math.round(damage.sizeCm * 10) / 10;
  return `${size} cm ${damage.kind}`;
}
