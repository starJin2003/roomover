/**
 * Drives a real sandbox dispute through Roomover's dispute path. PayPal sends
 * dispute webhooks to the deployed app only, so this runs the same code from
 * a laptop: the verifier agent reads the dispute, the order, and the
 * transaction through the PayPal Agent Toolkit. While the dispute is an
 * inquiry it writes Roomover's one message to the buyer, and once PayPal
 * asks for evidence it writes the note that goes out with the evidence
 * through the Disputes API. The sandbox only calls move a dispute along the
 * way a PayPal agent would.
 *
 *   pnpm paypal:dispute list
 *   pnpm paypal:dispute run <dispute-id> [--record]
 *   pnpm paypal:dispute require-evidence <dispute-id>
 *   pnpm paypal:dispute adjudicate <dispute-id> seller|buyer
 *
 * `--record` saves the verifier's replies, under one key per task, to the test recording and the
 * toolkit's transaction answer to the sandbox recording, which the end to
 * end test replays.
 */
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { toolkitReads, type PayPalReads } from "@/lib/agents/tools/paypal-read";
import { readReplyRecording, type ReplyRecording } from "@/lib/agents/recording";
import { liveVerifierTransport } from "@/lib/agents/verifier/transport";
import { readConfig } from "@/lib/config";
import { createDatabase, createPool } from "@/lib/db/client";
import { runDisputeAgent } from "@/lib/disputes/run";
import { paypalRest } from "@/lib/paypal/rest/client";
import { adjudicateDispute, requireDisputeEvidence } from "@/lib/paypal/rest/disputes";
import { reportScriptError } from "./report-error";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

const VERIFIER_RECORDING = "tests/fixtures/verifier-agent.json";
const SANDBOX_RECORDING = "tests/fixtures/paypal-sandbox.json";

const listSchema = z.object({
  items: z.array(z.object({ dispute_id: z.string(), reason: z.string().optional(), status: z.string().optional(), dispute_amount: z.object({ value: z.string() }).optional(), create_time: z.string().optional() })).default([]),
});

async function list(): Promise<void> {
  const answer = await paypalRest().request({ method: "GET", path: "/v1/customer/disputes", query: { page_size: 10 }, schema: listSchema });
  for (const dispute of answer.items) console.log(`${dispute.dispute_id}  ${dispute.status ?? "?"}  ${dispute.reason ?? "?"}  ${dispute.dispute_amount?.value ?? "?"} USD  ${dispute.create_time ?? ""}`);
}

/** Keeps the toolkit's transaction answer, so the test's recorded sandbox answers the same read with the same shape. */
function capturingReads(reads: PayPalReads, kept: Map<string, string>): PayPalReads {
  return {
    source: reads.source,
    async read(name, input) {
      const json = await reads.read(name, input);
      kept.set(name, json);
      return json;
    },
  };
}

async function run(disputeId: string, record: boolean): Promise<void> {
  const { DATABASE_URL, ANTHROPIC_API_KEY } = readConfig(["DATABASE_URL", "ANTHROPIC_API_KEY"]);
  const pool = createPool(DATABASE_URL, 2);
  // A run asks for one transport per verifier task, the inquiry message or the evidence note, each under its own key.
  const recorded = new Map<string, BetaMessage[]>();
  const kept = new Map<string, string>();
  try {
    const live = liveVerifierTransport(ANTHROPIC_API_KEY);
    const outcome = await runDisputeAgent(
      {
        db: createDatabase(pool),
        rest: paypalRest(),
        reads: capturingReads(toolkitReads(), kept),
        async transportFor(key) {
          const replies: BetaMessage[] = [];
          recorded.set(key, replies);
          return { mode: "live", transport: { send: async (request, call) => { const reply = await live.send(request, call); replies.push(reply); return reply; } } };
        },
        now: () => new Date(),
      },
      disputeId,
    );
    console.log(JSON.stringify(outcome.kind === "sent" ? { kind: outcome.kind, evidenceType: outcome.bundle.evidenceType, files: outcome.bundle.files, skipped: outcome.bundle.skipped, notes: outcome.bundle.notes } : outcome, null, 1));
    const replies = [...recorded.values()].flat();
    console.log(`Toolkit reads: ${[...kept.keys()].join(", ") || "none"}. Claude calls: ${replies.length}, input ${replies.reduce((sum, reply) => sum + reply.usage.input_tokens, 0)}, output ${replies.reduce((sum, reply) => sum + reply.usage.output_tokens, 0)}, cache read ${replies.reduce((sum, reply) => sum + (reply.usage.cache_read_input_tokens ?? 0), 0)}.`);
    const keys = [...recorded.entries()].filter(([, entries]) => entries.length > 0);
    if (record && keys.length > 0) {
      // The file is checked by reading it, then rewritten from its raw JSON, so the photo recordings keep their exact bytes.
      await readReplyRecording(VERIFIER_RECORDING);
      const existing = JSON.parse(await readFile(VERIFIER_RECORDING, "utf8")) as ReplyRecording;
      const disputes = { ...existing.disputes, ...Object.fromEntries(keys) };
      await writeFile(VERIFIER_RECORDING, `${JSON.stringify({ ...existing, disputes }, null, 1)}\n`);
      const transactions = kept.get("list_transactions");
      if (transactions !== undefined) {
        const sandbox = JSON.parse(await readFile(SANDBOX_RECORDING, "utf8")) as { templates: Record<string, unknown> };
        sandbox.templates.transactionSearch = JSON.parse(transactions);
        await writeFile(SANDBOX_RECORDING, `${JSON.stringify(sandbox, null, 1)}\n`);
      }
      console.log(`Recorded the run under ${keys.map(([key]) => key).join(" and ")}.`);
    }
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const [command, id, extra] = process.argv.slice(2);
  if (command === "list") return list();
  if (id === undefined) throw new Error("Pass a dispute ID.");
  if (command === "run") return run(id, extra === "--record");
  if (command === "require-evidence") {
    await requireDisputeEvidence(paypalRest(), id, "SELLER_EVIDENCE");
    console.log(`${id} now waits for the seller's evidence.`);
    return;
  }
  if (command === "adjudicate") {
    const outcome = z.enum(["seller", "buyer"]).parse(extra);
    await adjudicateDispute(paypalRest(), id, outcome === "seller" ? "SELLER_FAVOR" : "BUYER_FAVOR");
    console.log(`${id} settled for the ${outcome}.`);
    return;
  }
  throw new Error(`Unknown command ${command ?? "none"}. Use list, run, require-evidence, or adjudicate.`);
}

main().catch(reportScriptError);
