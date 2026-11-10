import { PayPalAgentToolkit } from "@paypal/agent-toolkit/bedrock";
import { describe, expect, it } from "vitest";
import {
  isPayPalReadToolName,
  PAYPAL_READ_DESCRIPTIONS,
  PAYPAL_READ_TOOL_NAMES,
  PayPalReadFailed,
  TOOLKIT_READ_ACTIONS,
  toolkitReads,
} from "@/lib/agents/tools/paypal-read";
import { DISPUTE_INSTRUCTIONS, buildDisputeRequest } from "@/lib/agents/verifier/dispute";

const credentials = { clientId: "test-client-id", clientSecret: "test-client-secret" };

// Toolkit methods that create, change, or move money. None may be reachable by an agent.
const TOOLKIT_WRITE_METHODS = [
  "create_order",
  "pay_order",
  "create_refund",
  "accept_dispute_claim",
  "create_invoice",
  "send_invoice",
  "cancel_sent_invoice",
  "record_payment_for_invoice",
  "record_refund_for_invoice",
  "create_subscription",
  "cancel_subscription",
  "update_subscription",
  "create_shipment_tracking",
  "update_shipment_tracking",
  "create_product",
  "update_plan",
];

const WRITE_VERB = /^(create|pay|capture|authorize|refund|void|accept|send|cancel|update|delete|record|activate|generate)_/;

describe("PayPal read tool allowlist", () => {
  it("is exactly the three read lookups", () => {
    expect([...PAYPAL_READ_TOOL_NAMES]).toEqual(["get_order", "list_transactions", "get_dispute"]);
  });

  it("contains no write tool", () => {
    for (const name of PAYPAL_READ_TOOL_NAMES) {
      expect(name).not.toMatch(WRITE_VERB);
      expect(TOOLKIT_WRITE_METHODS).not.toContain(name);
    }
    for (const name of TOOLKIT_WRITE_METHODS) {
      expect(isPayPalReadToolName(name)).toBe(false);
    }
  });

  it("makes the toolkit advertise only allowlisted tools", () => {
    const toolkit = new PayPalAgentToolkit({
      ...credentials,
      configuration: { actions: TOOLKIT_READ_ACTIONS, context: { sandbox: true } },
    });

    const advertised = toolkit.getTools().map((tool) => tool.toolSpec.name);

    expect([...advertised].sort()).toEqual([...PAYPAL_READ_TOOL_NAMES].sort());
  });

  it("gives the verifier's dispute run exactly the allowlisted reads, under the toolkit's names, plus its note", () => {
    const request = buildDisputeRequest([{ role: "user", content: "facts" }]);
    const names = (request.tools ?? []).map((tool) => ("name" in tool ? tool.name : ""));
    expect(names).toEqual([...PAYPAL_READ_TOOL_NAMES, "write_dispute_note"]);
    expect(names).not.toContain("accept_dispute_claim");
    for (const name of PAYPAL_READ_TOOL_NAMES) expect(PAYPAL_READ_DESCRIPTIONS[name].length).toBeGreaterThan(20);
    expect(DISPUTE_INSTRUCTIONS).toMatch(/Do not argue, speculate about the buyer, accept the claim, offer a refund, or promise anything/);
  });

  it("refuses a write tool and invalid input before anything reaches PayPal", async () => {
    const reads = toolkitReads(credentials);
    await expect(reads.read("accept_dispute_claim" as never, { dispute_id: "PP-D-1", note: "x" })).rejects.toBeInstanceOf(PayPalReadFailed);
    await expect(reads.read("get_order", { id: "../../v1/payments/payouts" })).rejects.toThrow(/get_order input is invalid/);
    await expect(reads.read("list_transactions", { search_months: 12 })).rejects.toThrow(/list_transactions input is invalid/);
    await expect(reads.read("get_dispute", { dispute_id: "PP-D-1/../accept-claim" })).rejects.toThrow(/get_dispute input is invalid/);
  });
});
