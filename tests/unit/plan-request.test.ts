import { describe, expect, it } from "vitest";
import { readBudget, readPlanPrompt } from "@/lib/domain/plan-request";

describe("readBudget", () => {
  it.each([
    ["$150, cozy, I study late", 15_000],
    ["cozy for $1,200 please", 120_000],
    ["$ 99.5 and calm", 9_950],
    ["about 150 dollars", 15_000],
    ["80 bucks", 8_000],
    ["300 USD, bright", 30_000],
    ["$150 total, keep it under $150", 15_000],
  ])("reads %s", (text, cents) => {
    expect(readBudget(text)).toEqual({ ok: true, budgetCents: cents });
  });

  it("asks for a budget when there is none, and one budget when there are two", () => {
    expect(readBudget("cozy, I study late")).toEqual({ ok: false, error: "Add a budget in dollars, for example $150." });
    expect(readBudget("$150 or maybe $200")).toEqual({ ok: false, error: "Give one budget, for example $150." });
  });

  it("ignores numbers that are not money", () => {
    expect(readBudget("room 214, two lamps")).toEqual({ ok: false, error: "Add a budget in dollars, for example $150." });
  });

  it("keeps the budget between $20 and $2,000", () => {
    expect(readBudget("$5")).toEqual({ ok: false, error: "Keep the budget between $20 and $2,000." });
    expect(readBudget("$5,000")).toEqual({ ok: false, error: "Keep the budget between $20 and $2,000." });
  });
});

describe("readPlanPrompt", () => {
  it("collapses spaces and keeps the student's words", () => {
    expect(readPlanPrompt("  $150,   cozy\n I study late ")).toEqual({ ok: true, prompt: "$150, cozy I study late", budgetCents: 15_000 });
  });

  it("rejects empty and overlong requests", () => {
    expect(readPlanPrompt("   ").ok).toBe(false);
    expect(readPlanPrompt(`$150 ${"cozy ".repeat(80)}`)).toEqual({ ok: false, error: "Keep it under 280 characters." });
  });
});
