import type { ConditionGrade } from "@/lib/domain/listing";

const MINUS = "−";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Expected integer cents, got ${cents}.`);
}

/** 1600 becomes $16.00. Negative amounts use a true minus sign. */
export function formatUsd(cents: number): string {
  assertCents(cents);
  return usd.format(cents / 100).replace("-", MINUS);
}

/** Whole dollars drop their cents, so 5200 reads $52 and 3525 reads $35.25. */
export function formatUsdShort(cents: number): string {
  assertCents(cents);
  return cents % 100 === 0 ? usdWhole.format(cents / 100).replace("-", MINUS) : formatUsd(cents);
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

const campusDay = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });

/** A campus date range, such as Nov 17 to 25, or Nov 30 to Dec 2 across a month. */
export function formatDayRange(start: Date, end: Date): string {
  const from = campusDay.formatToParts(start);
  const to = campusDay.formatToParts(end);
  const month = (parts: Intl.DateTimeFormatPart[]) => parts.find((part) => part.type === "month")?.value;
  const day = (parts: Intl.DateTimeFormatPart[]) => parts.find((part) => part.type === "day")?.value;
  return month(from) === month(to) ? `${month(from)} ${day(from)} to ${day(to)}` : `${campusDay.format(start)} to ${campusDay.format(end)}`;
}
