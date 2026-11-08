import { CONDITION_GRADES, type ConditionGrade } from "@/lib/domain/listing";
import type { HandoffMode } from "@/lib/domain/enums";

const MINUS = "−";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdChange = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", signDisplay: "exceptZero" });

function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Expected integer cents, got ${cents}.`);
}

/** 1600 becomes $16.00. Negative amounts use a true minus sign. */
export function formatUsd(cents: number): string {
  assertCents(cents);
  return usd.format(cents / 100).replace("-", MINUS);
}

/** A balance change, such as +$16.00 or −$136.00. Zero has no sign. */
export function formatUsdChange(cents: number): string {
  assertCents(cents);
  return usdChange.format(cents / 100).replace("-", MINUS);
}

export type SizeMm = readonly [width: number, depth: number, height: number];

/** One decimal below 1, so a thin rug never reads as 0. */
function belowOne(value: number): string {
  return String(Math.max(0.1, Math.round(value * 10) / 10));
}

/** Whole and half inches. */
function inches(mm: number): string {
  const value = mm / 25.4;
  return value < 1 ? belowOne(value) : String(Math.round(value * 2) / 2);
}

function centimeters(mm: number): string {
  const value = mm / 10;
  return value < 1 ? belowOne(value) : String(Math.round(value));
}

/** Width by depth by height, such as 16.5 × 7 × 19 in. */
export function formatInches(size: SizeMm): string {
  return `${size.map(inches).join(" × ")} in`;
}

/** Width by depth by height, such as 42 × 18 × 48 cm. */
export function formatCentimeters(size: SizeMm): string {
  return `${size.map(centimeters).join(" × ")} cm`;
}

export const CONDITION_LABEL: Readonly<Record<ConditionGrade, string>> = {
  like_new: "Like new",
  good: "Good",
  fair: "Fair",
  worn: "Worn",
};

/** Like new scores 4 and worn scores 1, for the condition meter. */
export function conditionScore(grade: ConditionGrade): number {
  return CONDITION_GRADES.length - CONDITION_GRADES.indexOf(grade);
}

export const HANDOFF_MODE_LABEL: Readonly<Record<HandoffMode, string>> = {
  direct: "Direct handoff",
  storage_hold: "Storage hold",
  same_room: "Same room",
};
