import { describe, expect, it } from "vitest";
import {
  captureKey,
  idempotencyKey,
  orderCreateKey,
  payoutKey,
  refundKey,
} from "@/lib/paypal/idempotency";

describe("idempotency keys", () => {
  it("gives a retry of the same attempt the same key", () => {
    expect(captureKey("item_42", 1)).toBe(captureKey("item_42", 1));
    expect(payoutKey("settlement-7", 2)).toBe(payoutKey("settlement-7", 2));
  });

  it("gives a new attempt a new key", () => {
    expect(captureKey("item_42", 2)).not.toBe(captureKey("item_42", 1));
  });

  it("gives different records and different actions different keys", () => {
    expect(captureKey("item_42", 1)).not.toBe(captureKey("item_43", 1));
    expect(captureKey("item_42", 1)).not.toBe(refundKey("item_42", 1));
  });

  it("keeps the format readable in PayPal logs", () => {
    expect(orderCreateKey("3f1c9a2e-8d4b-4e7a-9c1f-2b6d8e0a4c55", 1)).toBe(
      "rmv.order-create.3f1c9a2e-8d4b-4e7a-9c1f-2b6d8e0a4c55.1",
    );
  });

  it.each(["", "has space", "dot.ted", "a".repeat(65)])("rejects record ID %j", (recordId) => {
    expect(() => idempotencyKey("capture", recordId, 1)).toThrow(RangeError);
  });

  it.each([0, -1, 1.5])("rejects attempt %d", (attempt) => {
    expect(() => idempotencyKey("capture", "item_42", attempt)).toThrow(RangeError);
  });
});
