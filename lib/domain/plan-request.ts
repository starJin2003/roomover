import { formatUsdShort } from "@/lib/format";

/**
 * Reads the budget out of the student's own words, such as "$150, cozy, I
 * study late". The budget becomes a hard limit in code, so it is parsed here
 * and never left to the model.
 */

export const BUDGET_MIN_CENTS = 2_000;
export const BUDGET_MAX_CENTS = 200_000;
export const PROMPT_MAX_LENGTH = 280;
export const CHANGE_REQUEST_MAX_LENGTH = 200;

export type BudgetReading = { ok: true; budgetCents: number } | { ok: false; error: string };

// "$150", "$1,200", "$150.50", "150 dollars", "150 bucks", "150 usd"
const AMOUNT = /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?|\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(?:dollars?|bucks|usd)\b/gi;

function toCents(whole: string, fraction: string | undefined): number {
  const dollars = Number(whole.replaceAll(",", ""));
  const cents = fraction === undefined ? 0 : Number(fraction.padEnd(2, "0"));
  return dollars * 100 + cents;
}

export function readBudget(text: string): BudgetReading {
  const amounts = [...text.matchAll(AMOUNT)].map((match) =>
    match[1] !== undefined ? toCents(match[1], match[2]) : toCents(match[3], match[4]),
  );
  const distinct = [...new Set(amounts)];
  if (distinct.length === 0) return { ok: false, error: "Add a budget in dollars, for example $150." };
  if (distinct.length > 1) return { ok: false, error: "Give one budget, for example $150." };
  const [budgetCents] = distinct;
  if (budgetCents < BUDGET_MIN_CENTS || budgetCents > BUDGET_MAX_CENTS) {
    return { ok: false, error: `Keep the budget between ${formatUsdShort(BUDGET_MIN_CENTS)} and ${formatUsdShort(BUDGET_MAX_CENTS)}.` };
  }
  return { ok: true, budgetCents };
}

export type PromptReading = { ok: true; prompt: string; budgetCents: number } | { ok: false; error: string };

/** The whole request as the plan stores it, with the budget read from it. */
export function readPlanPrompt(raw: string): PromptReading {
  const prompt = raw.replace(/\s+/g, " ").trim();
  if (prompt.length === 0) return { ok: false, error: "Describe the room you want, for example $150, cozy, I study late." };
  if (prompt.length > PROMPT_MAX_LENGTH) return { ok: false, error: `Keep it under ${PROMPT_MAX_LENGTH} characters.` };
  const budget = readBudget(prompt);
  return budget.ok ? { ok: true, prompt, budgetCents: budget.budgetCents } : budget;
}
