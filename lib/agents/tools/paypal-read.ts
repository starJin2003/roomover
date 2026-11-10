import { PayPalAgentToolkit } from "@paypal/agent-toolkit/bedrock";
import { z } from "zod";
import { TOOLKIT_READ_TOOLS, type ToolkitReadTool } from "@/lib/domain/agent-events";
import { readPayPalCredentials, type PayPalCredentials } from "@/lib/paypal/config";

/**
 * Read only PayPal lookups for agents, backed by the PayPal Agent Toolkit.
 *
 * Every money moving call lives in Roomover's own SDK and REST code, so these
 * three names are the complete list an agent can reach. The toolkit's own
 * `actions` setting only filters the tool list it advertises, and its
 * dispatcher runs any method name it is given, so this module checks the name
 * against the allowlist before anything reaches the toolkit.
 */
export const PAYPAL_READ_TOOL_NAMES = TOOLKIT_READ_TOOLS;

export type PayPalReadToolName = ToolkitReadTool;

export function isPayPalReadToolName(name: string): name is PayPalReadToolName {
  return (PAYPAL_READ_TOOL_NAMES as readonly string[]).includes(name);
}

/** Toolkit action switches that advertise exactly the allowlisted tools. */
export const TOOLKIT_READ_ACTIONS = {
  orders: { get: true },
  transactions: { list: true },
  disputes: { get: true },
};

const isoDateTime = z.iso.datetime({ offset: true });

const READ_TOOLS = {
  get_order: {
    description:
      "Look up a PayPal order by ID. Returns its status, purchase units, items, amounts, and any authorizations, captures, or refunds recorded on it.",
    inputSchema: z.object({
      id: z.string().regex(/^[A-Z0-9]{17,32}$/).describe("PayPal order ID, for example 5O190127TN364715T"),
    }),
  },
  list_transactions: {
    description:
      "List PayPal transactions on the Roomover platform account in a window of at most 31 days, or find one transaction by ID. New transactions can take up to three hours to appear.",
    inputSchema: z.object({
      transaction_id: z
        .string()
        .regex(/^[A-Za-z0-9_-]{12,255}$/)
        .optional()
        .describe("PayPal transaction ID to find"),
      search_months: z
        .number()
        .int()
        .min(1)
        .max(3)
        .default(1)
        .describe("With transaction_id, how many 31 day windows to search back from now"),
      start_date: isoDateTime.optional().describe("Window start, RFC 3339 with seconds"),
      end_date: isoDateTime.optional().describe("Window end, RFC 3339 with seconds"),
      transaction_status: z
        .enum(["D", "P", "S", "V"])
        .optional()
        .describe("D denied, P pending, S successful, V reversed"),
      page_size: z.number().int().min(1).max(100).default(20),
      page: z.number().int().min(1).max(100).default(1),
    }),
  },
  get_dispute: {
    description:
      "Look up a PayPal dispute by ID. Returns the reason, status, disputed amount, disputed transactions, and the seller response due date.",
    inputSchema: z.object({
      dispute_id: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/).describe("PayPal dispute ID, for example PP-D-27803"),
    }),
  },
} satisfies Record<PayPalReadToolName, { description: string; inputSchema: z.ZodObject }>;

type Toolkit = InstanceType<typeof PayPalAgentToolkit>;

function createToolkit(credentials: PayPalCredentials): Toolkit {
  const toolkit = new PayPalAgentToolkit({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    // Without `sandbox: true` the toolkit calls the live PayPal API.
    configuration: { actions: TOOLKIT_READ_ACTIONS, context: { sandbox: true } },
  });
  const advertised = toolkit.getTools().map((tool) => tool.toolSpec.name);
  const unexpected = advertised.filter((name) => !isPayPalReadToolName(name));
  if (unexpected.length > 0) {
    throw new Error(`PayPal Agent Toolkit advertised tools outside the allowlist: ${unexpected.join(", ")}.`);
  }
  return toolkit;
}

// The toolkit wraps its JSON result in a second JSON string and reports
// failures as a result object, so both layers are unwrapped here.
const toolkitFailureSchema = z.union([
  z.object({ error: z.object({ message: z.string() }) }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);

/** A lookup the toolkit could not answer, with PayPal's own message. */
export class PayPalReadFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayPalReadFailed";
  }
}

async function runReadTool(toolkit: Toolkit, name: string, input: unknown): Promise<string> {
  if (!isPayPalReadToolName(name)) throw new PayPalReadFailed(`${name} is not an available PayPal tool.`);
  const parsed = READ_TOOLS[name].inputSchema.safeParse(input);
  if (!parsed.success) throw new PayPalReadFailed(`${name} input is invalid. ${z.prettifyError(parsed.error)}`);
  const result = await toolkit.handleToolCall({ toolUseId: name, name, input: parsed.data });
  const outer: unknown = JSON.parse(result.content[0]?.text ?? '""');
  const json = typeof outer === "string" ? outer : JSON.stringify(outer);

  const failure = toolkitFailureSchema.safeParse(JSON.parse(json));
  if (failure.success) {
    const message = "error" in failure.data ? failure.data.error.message : failure.data.message;
    throw new PayPalReadFailed(`PayPal lookup failed: ${message}`);
  }
  return json;
}

/** Read only PayPal lookups by tool name, answered with PayPal's own JSON. */
export interface PayPalReads {
  /** Where the answers come from, which the activity panel names. */
  readonly source: "agent_toolkit" | "recorded";
  read(name: PayPalReadToolName, input: unknown): Promise<string>;
}

/** The tool descriptions agents see, keyed by the toolkit's own names. */
export const PAYPAL_READ_DESCRIPTIONS: Readonly<Record<PayPalReadToolName, string>> = {
  get_order: READ_TOOLS.get_order.description,
  list_transactions: READ_TOOLS.list_transactions.description,
  get_dispute: READ_TOOLS.get_dispute.description,
};

/**
 * Lookups through the PayPal Agent Toolkit. The toolkit caches its own
 * access token with no refresh, so each agent run builds a fresh set.
 */
export function toolkitReads(credentials: PayPalCredentials = readPayPalCredentials()): PayPalReads {
  const toolkit = createToolkit(credentials);
  return { source: "agent_toolkit", read: (name, input) => runReadTool(toolkit, name, input) };
}
