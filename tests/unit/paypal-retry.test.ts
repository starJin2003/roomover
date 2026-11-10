import { describe, expect, it, vi } from "vitest";
import { PayPalApiError, PayPalResponseError } from "@/lib/paypal/errors";
import { isDefinite, isTransient, keyedWrite } from "@/lib/paypal/retry";

const apiError = (status: number) => new PayPalApiError({ operation: "capture", status, errorName: `HTTP_${status}`, message: "No", details: [], debugId: undefined });

describe("which PayPal failures move a record to its next attempt", () => {
  it("treats a 4xx refusal as definite, and a timeout, a conflict, a rate limit, or a 5xx as unknown", () => {
    for (const status of [400, 401, 403, 404, 422]) expect(isDefinite(apiError(status))).toBe(true);
    for (const status of [408, 409, 429, 500, 503]) expect(isDefinite(apiError(status))).toBe(false);
    expect(isDefinite(new Error("timeout of 20000ms exceeded"))).toBe(false);
    // A 2xx Roomover could not read may have moved money, so it keeps the key and is not retried.
    expect(isDefinite(new PayPalResponseError("capture", undefined, ["id"]))).toBe(false);
    expect(isTransient(new PayPalResponseError("capture", undefined, ["id"]))).toBe(false);
  });

  it("moves to the next attempt after a refusal and keeps the attempt after a lost answer", async () => {
    const nextAttempt = vi.fn(async () => undefined);
    await expect(keyedWrite(() => Promise.reject(apiError(422)), nextAttempt)).rejects.toBeInstanceOf(PayPalApiError);
    expect(nextAttempt).toHaveBeenCalledTimes(1);

    nextAttempt.mockClear();
    const lost = vi.fn(() => Promise.reject(new Error("socket hang up")));
    await expect(keyedWrite(lost, nextAttempt)).rejects.toThrow("socket hang up");
    expect(lost).toHaveBeenCalledTimes(2);
    expect(nextAttempt).not.toHaveBeenCalled();
  });

  it("returns the answer of a retry that lands after one transient failure", async () => {
    const run = vi.fn<() => Promise<string>>().mockRejectedValueOnce(apiError(503)).mockResolvedValueOnce("CAP-1");
    const nextAttempt = vi.fn(async () => undefined);
    await expect(keyedWrite(run, nextAttempt)).resolves.toBe("CAP-1");
    expect(nextAttempt).not.toHaveBeenCalled();
  });
});
