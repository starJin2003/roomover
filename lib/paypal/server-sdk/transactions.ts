import { TransactionSearchController, type SearchResponse } from "@paypal/paypal-server-sdk";
import { callSdk, type PayPalSdk } from "@/lib/paypal/server-sdk/client";

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_PAGE_SIZE = 500;

export interface TransactionSearchInput {
  readonly start: Date;
  readonly end: Date;
  readonly transactionId?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

/** The reporting API documents RFC 3339 dates with whole seconds. */
function reportingDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Lists balance affecting transactions in a window of at most 31 days.
 * Transactions take up to three hours to appear in this API.
 */
export function searchTransactions(sdk: PayPalSdk, input: TransactionSearchInput): Promise<SearchResponse> {
  const rangeMs = input.end.getTime() - input.start.getTime();
  if (!(rangeMs > 0 && rangeMs <= MAX_RANGE_MS)) {
    throw new RangeError("Transaction search needs an end after the start and a range of at most 31 days.");
  }
  if (input.pageSize !== undefined && !(input.pageSize >= 1 && input.pageSize <= MAX_PAGE_SIZE)) {
    throw new RangeError(`pageSize must be between 1 and ${MAX_PAGE_SIZE}.`);
  }

  return callSdk(sdk, "GET /v1/reporting/transactions", () =>
    new TransactionSearchController(sdk.client).searchTransactions({
      startDate: reportingDate(input.start),
      endDate: reportingDate(input.end),
      transactionId: input.transactionId,
      fields: "all",
      page: input.page,
      pageSize: input.pageSize,
    }),
  );
}
