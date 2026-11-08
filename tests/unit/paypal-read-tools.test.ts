import { PayPalAgentToolkit } from "@paypal/agent-toolkit/bedrock";
import { describe, expect, it } from "vitest";
import {
  createPayPalReadTools,
  isPayPalReadToolName,
  PAYPAL_READ_TOOL_NAMES,
  TOOLKIT_READ_ACTIONS,
} from "@/lib/agents/tools/paypal-read";

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

  it("exposes one Anthropic tool definition per allowlisted name", () => {
    const tools = createPayPalReadTools(credentials);

    expect(tools.map((tool) => tool.name)).toEqual([...PAYPAL_READ_TOOL_NAMES]);
    for (const tool of tools) {
      if (!("input_schema" in tool)) throw new Error(`${tool.name} is not a custom tool definition.`);
      expect(tool.description?.length).toBeGreaterThan(20);
      expect(tool.input_schema).toMatchObject({ type: "object" });
    }
  });

  it("validates agent input before anything reaches PayPal", () => {
    const getOrder = createPayPalReadTools(credentials).find((tool) => tool.name === "get_order");

    expect(() => getOrder?.parse({ id: "../../v1/payments/payouts" })).toThrow();
    expect(getOrder?.parse({ id: "5O190127TN364715T" })).toEqual({ id: "5O190127TN364715T" });
  });

  it("fills list_transactions defaults so the toolkit never sees an unbounded search", () => {
    const listTransactions = createPayPalReadTools(credentials).find((tool) => tool.name === "list_transactions");

    expect(listTransactions?.parse({})).toEqual({ search_months: 1, page_size: 20, page: 1 });
    expect(() => listTransactions?.parse({ search_months: 12 })).toThrow();
  });
});
