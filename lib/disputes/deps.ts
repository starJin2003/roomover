import { z } from "zod";
import { toolkitReads, type PayPalReads } from "@/lib/agents/tools/paypal-read";
import { disputeTransportFor } from "@/lib/agents/verifier/transport";
import { readOptionalConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { paypalRest } from "@/lib/paypal/rest/client";
import type { PayPalRestClient } from "@/lib/paypal/rest/client";
import type { DisputeDeps } from "./run";

const json = z.unknown();

/**
 * Tests only. The same three reads answered by the simulated sandbox the
 * rest of the test run uses, with PayPal's own JSON shapes, because the
 * toolkit always calls the real sandbox.
 */
export function recordedReads(rest: PayPalRestClient): PayPalReads {
  return {
    source: "recorded",
    async read(name, input) {
      const fields = input as Record<string, string>;
      const answer =
        name === "get_dispute"
          ? await rest.request({ method: "GET", path: `/v1/customer/disputes/${encodeURIComponent(fields.dispute_id)}`, schema: json })
          : name === "get_order"
            ? await rest.request({ method: "GET", path: `/v2/checkout/orders/${encodeURIComponent(fields.id)}`, schema: json })
            : await rest.request({ method: "GET", path: "/v1/reporting/transactions", query: { transaction_id: fields.transaction_id }, schema: json });
      return JSON.stringify(answer);
    },
  };
}

/** The Agent Toolkit against the sandbox, or the recorded sandbox when a test run set one. */
export function disputeReads(): PayPalReads {
  return readOptionalConfig("ROOMOVER_PAYPAL_FIXTURE") === undefined ? toolkitReads() : recordedReads(paypalRest());
}

export function liveDisputeDeps(): DisputeDeps {
  return { db: getDb(), rest: paypalRest(), reads: disputeReads(), transportFor: disputeTransportFor, now: () => new Date() };
}
