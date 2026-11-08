import { CURRENCY, centsToDecimal, decimalToCents } from "@/lib/domain/money";

/**
 * PayPal spells the same amount three ways. The Server SDK uses camelCase,
 * Orders and Payments REST bodies use currency_code, and Payouts uses currency.
 */

export const sdkMoney = (cents: number) => ({ currencyCode: CURRENCY, value: centsToDecimal(cents) });

export const restMoney = (cents: number) => ({ currency_code: CURRENCY, value: centsToDecimal(cents) });

export const payoutMoney = (cents: number) => ({ currency: CURRENCY, value: centsToDecimal(cents) });

export function moneyToCents(money: { readonly value: string; readonly currency: string }): number {
  if (money.currency !== CURRENCY) {
    throw new RangeError(`Roomover handles ${CURRENCY} only and received ${money.currency}.`);
  }
  return decimalToCents(money.value);
}
