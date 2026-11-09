import { describe, expect, it } from "vitest";
import { ChoiceRefused, choicesFor, majorDamageCents, minorDamageCents, settleChoice, type Finding } from "@/lib/domain/money-policy";

const match: Finding = { verdict: "match" };
const minor: Finding = { verdict: "new_damage", damage: { severity: "minor" } };
const major: Finding = { verdict: "new_damage", damage: { severity: "major" } };
const wrong: Finding = { verdict: "wrong_item" };
const missing: Finding = { verdict: "missing" };
const none: Finding = { verdict: "none" };

describe("minor damage", () => {
  it("takes 15 percent off and rounds to the nearest dollar", () => {
    expect(minorDamageCents(3_500)).toBe(3_000); // 29.75 rounds up to 30
    expect(minorDamageCents(5_500)).toBe(4_700); // 46.75
    expect(minorDamageCents(1_600)).toBe(1_400); // 13.60
    expect(minorDamageCents(800)).toBe(700); // 6.80
    expect(minorDamageCents(1_234)).toBe(1_000); // 10.489
  });

  it("rounds a half dollar up, exactly", () => {
    expect(minorDamageCents(1_000)).toBe(900); // 8.50
    expect(minorDamageCents(3_000)).toBe(2_600); // 25.50
    expect(minorDamageCents(7_000)).toBe(6_000); // 59.50
  });

  it("never charges more than the price or less than a cent", () => {
    expect(minorDamageCents(100)).toBe(100); // 0.85 rounds to 1
    expect(minorDamageCents(50)).toBe(42); // 0.425 would round to nothing, so it keeps the cents
    expect(minorDamageCents(1)).toBe(1);
  });

  it("refuses a price that is not positive whole cents", () => {
    expect(() => minorDamageCents(0)).toThrow(RangeError);
    expect(() => minorDamageCents(12.5)).toThrow(RangeError);
  });
});

describe("major damage", () => {
  it("keeps the item at half price, with an odd cent going to the student", () => {
    expect(majorDamageCents(3_500)).toBe(1_750);
    expect(majorDamageCents(3_525)).toBe(1_762);
    expect(majorDamageCents(1)).toBe(1);
  });
});

describe("choices", () => {
  it("offers the recommended choice first for every finding", () => {
    expect(choicesFor(match)).toEqual(["accept", "turn_down"]);
    expect(choicesFor(minor)).toEqual(["accept", "turn_down"]);
    expect(choicesFor(major)).toEqual(["keep_half", "turn_down"]);
    expect(choicesFor(wrong)).toEqual(["turn_down", "accept"]);
    expect(choicesFor(missing)).toEqual(["not_here"]);
    expect(choicesFor(none)).toEqual(["not_here"]);
  });
});

describe("settleChoice", () => {
  it("pays the full price for a match", () => {
    expect(settleChoice(match, "accept", 5_500)).toEqual({ decision: "accepted", payCents: 5_500, releasedCents: 0 });
  });

  it("pays $30 of $35 for a chair with a minor new tear", () => {
    expect(settleChoice(minor, "accept", 3_500)).toEqual({ decision: "adjusted", payCents: 3_000, releasedCents: 500 });
  });

  it("calls a minor finding accepted when rounding leaves the price as it was", () => {
    expect(settleChoice(minor, "accept", 100)).toEqual({ decision: "accepted", payCents: 100, releasedCents: 0 });
  });

  it("lets the student keep major damage at half price or turn it down", () => {
    expect(settleChoice(major, "keep_half", 3_500)).toEqual({ decision: "adjusted", payCents: 1_750, releasedCents: 1_750 });
    expect(settleChoice(major, "turn_down", 3_500)).toEqual({ decision: "rejected", payCents: 0, releasedCents: 3_500 });
  });

  it("releases a wrong item, unless the student keeps it at the full price", () => {
    expect(settleChoice(wrong, "turn_down", 1_600)).toEqual({ decision: "rejected", payCents: 0, releasedCents: 1_600 });
    expect(settleChoice(wrong, "accept", 1_600)).toEqual({ decision: "accepted", payCents: 1_600, releasedCents: 0 });
  });

  it("releases a missing item, with or without a photo", () => {
    expect(settleChoice(missing, "not_here", 800)).toEqual({ decision: "missing", payCents: 0, releasedCents: 800 });
    expect(settleChoice(none, "not_here", 800)).toEqual({ decision: "missing", payCents: 0, releasedCents: 800 });
  });

  it("lets the student turn down a matching item", () => {
    expect(settleChoice(match, "turn_down", 3_000)).toEqual({ decision: "rejected", payCents: 0, releasedCents: 3_000 });
  });

  it("refuses a choice the finding does not offer", () => {
    expect(() => settleChoice(minor, "keep_half", 3_500)).toThrow(ChoiceRefused);
    expect(() => settleChoice(major, "accept", 3_500)).toThrow(ChoiceRefused);
    expect(() => settleChoice(match, "not_here", 3_500)).toThrow(ChoiceRefused);
    expect(() => settleChoice(none, "accept", 3_500)).toThrow(ChoiceRefused);
  });

  it("always splits the price between what the seller gets and what comes back", () => {
    const findings: Finding[] = [match, minor, major, wrong, missing, none];
    for (const finding of findings) {
      for (const choice of choicesFor(finding)) {
        for (const price of [1, 99, 800, 1_000, 3_500, 3_525, 18_000]) {
          const settled = settleChoice(finding, choice, price);
          expect(settled.payCents + settled.releasedCents).toBe(price);
          expect(settled.payCents).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
