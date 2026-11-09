/** How a Log in with PayPal round trip can end without a seller, as the callback reports it to Sell. */
export const LOGIN_OUTCOMES = ["failed", "canceled", "no_account", "platform"] as const;
export type LoginOutcome = (typeof LOGIN_OUTCOMES)[number];

export const LOGIN_SENTENCE: Readonly<Record<LoginOutcome, string>> = {
  failed: "PayPal did not finish the log in, so you are not signed in. Press Log in with PayPal to try again.",
  canceled: "You left PayPal before logging in, so nothing changed.",
  no_account: "PayPal shared neither your PayPal ID nor your email, so Roomover would have nowhere to pay you. Try again, and allow both.",
  platform: "That PayPal account is Roomover's own business account. Log in with a personal sandbox account to sell.",
};

export function loginOutcome(value: string | undefined): LoginOutcome | null {
  return LOGIN_OUTCOMES.find((outcome) => outcome === value) ?? null;
}
