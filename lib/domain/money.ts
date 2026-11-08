/**
 * Money inside the domain is a non-negative integer number of cents in USD.
 * Decimal strings exist only at API boundaries, and every conversion here is
 * string or integer arithmetic so no floating point value ever holds money.
 */

export const CURRENCY = "USD";

const DECIMAL_AMOUNT = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

function assertCents(value: number, label = "amount"): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer number of cents.`);
  }
}

/** 1234 becomes "12.34" and 5 becomes "0.05". */
export function centsToDecimal(cents: number): string {
  assertCents(cents);
  const whole = Math.trunc(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

/** Reads "12.34", "12.3", or "12" as cents. Rejects signs, exponents, and a third decimal place. */
export function decimalToCents(value: string): number {
  const match = DECIMAL_AMOUNT.exec(value);
  if (match === null) {
    throw new RangeError(`"${value}" is not a USD amount with at most two decimal places.`);
  }
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const cents = Number(match[1]) * 100 + Number(fraction);
  assertCents(cents);
  return cents;
}

export function sumCents(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    assertCents(value);
    total += value;
  }
  assertCents(total, "total");
  return total;
}

/**
 * Splits a total into `parts` shares that differ by at most one cent. The
 * leftover cents go to the earliest shares, so 1.00 over three items is
 * 0.34, 0.33, 0.33.
 */
export function splitEvenly(total: number, parts: number): number[] {
  assertCents(total, "total");
  if (!Number.isSafeInteger(parts) || parts < 1) {
    throw new RangeError("parts must be a positive integer.");
  }
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
}

/**
 * Splits a total in proportion to integer weights (usually list prices in
 * cents) with the largest remainder method. Shares always sum to the total.
 * Ties go to the earlier weight, so the result is deterministic.
 */
export function allocateByWeight(total: number, weights: readonly number[]): number[] {
  assertCents(total, "total");
  if (weights.length === 0) {
    throw new RangeError("weights must not be empty.");
  }
  weights.forEach((weight) => assertCents(weight, "weight"));

  const weightSum = weights.reduce((sum, weight) => sum + BigInt(weight), BigInt(0));
  if (weightSum === BigInt(0)) {
    throw new RangeError("at least one weight must be positive.");
  }

  const bigTotal = BigInt(total);
  const shares = weights.map((weight) => {
    const product = bigTotal * BigInt(weight);
    return { floor: product / weightSum, remainder: product % weightSum };
  });

  let leftover = bigTotal - shares.reduce((sum, share) => sum + share.floor, BigInt(0));
  const order = shares
    .map((share, index) => ({ index, remainder: share.remainder }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );

  const result = shares.map((share) => share.floor);
  for (const { index } of order) {
    if (leftover === BigInt(0)) break;
    result[index] += BigInt(1);
    leftover -= BigInt(1);
  }
  return result.map(Number);
}
