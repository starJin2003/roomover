import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { strictSchema } from "@/lib/agents/strict-schema";
import { NEGOTIATOR_INSTRUCTIONS, negotiationMessage, type OfferFacts } from "./negotiate-prompt";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaTool = Anthropic.Beta.Messages.BetaTool;
type ToolUse = Anthropic.Beta.Messages.BetaToolUseBlock;
export type NegotiatorRequest = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

export const NEGOTIATOR_MODEL = "claude-sonnet-5-5";
/** An offer is a short judgment over a few numbers, so low effort answers in a couple of seconds. */
export const NEGOTIATOR_EFFORT = "low" as const;
const MAX_TOKENS = 4_000;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const TOOL_NAME = "answer_offer";
const REQUEST_TIMEOUT_MS = 45_000;

export const answerOfferSchema = z.strictObject({
  action: z.enum(["accept", "counter", "decline"]).describe("accept takes the student's offer as it stands, counter names a new price, decline ends this round."),
  counterDollars: z.number().int().positive().nullable().describe("Whole dollars for a counter. Null when you accept or decline."),
  slotNumber: z.number().int().positive().nullable().describe("For a counter, the number of a slot from the list when the student's slot does not suit the seller. Null keeps the student's slot."),
  message: z.string().min(1).max(200).describe("One short, friendly sentence for the student's agent that names the price."),
});

export type AnswerOffer = z.infer<typeof answerOfferSchema>;

export const ANSWER_OFFER_TOOL: BetaTool = {
  name: TOOL_NAME,
  description: "Answer the buyer agent's offer for the seller: accept it, counter with a whole dollar price and optionally another slot from the list, or decline.",
  input_schema: strictSchema(z.toJSONSchema(answerOfferSchema)) as BetaTool["input_schema"],
  strict: true,
};

export function buildNegotiatorRequest(messages: BetaMessageParam[]): NegotiatorRequest {
  return {
    model: NEGOTIATOR_MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: NEGOTIATOR_EFFORT },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    // The tool and the instructions are the same on every call, so they are read from cache after the first.
    system: [{ type: "text", text: NEGOTIATOR_INSTRUCTIONS, cache_control: { type: "ephemeral" } }],
    tools: [ANSWER_OFFER_TOOL],
    // Sonnet 5.5 refuses forced tool choice, so the instructions name the tool and code checks it was called.
    tool_choice: { type: "auto" },
    messages,
  };
}

export interface NegotiatorTransport {
  readonly mode: "live" | "fixture";
  send(request: NegotiatorRequest, call: number): Promise<BetaMessage>;
}

export interface OfferUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const NO_USAGE: OfferUsage = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export type AnswerResult = { ok: true; answer: AnswerOffer; attempts: 1 | 2; usage: OfferUsage } | { ok: false; error: string; usage: OfferUsage };

type Reading = { ok: true; answer: AnswerOffer } | { ok: false; reply: Anthropic.Beta.Messages.BetaContentBlockParam[] };

function readAnswer(message: BetaMessage, facts: OfferFacts): Reading {
  const call = message.content.find((block): block is ToolUse => block.type === "tool_use" && block.name === TOOL_NAME);
  if (call === undefined) return { ok: false, reply: [{ type: "text", text: "You did not call answer_offer. Call it now." }] };
  const parsed = answerOfferSchema.safeParse(call.input);
  const problem = !parsed.success
    ? z.prettifyError(parsed.error)
    : parsed.data.action === "counter" && parsed.data.counterDollars === null
      ? "A counter needs counterDollars."
      : parsed.data.slotNumber !== null && !facts.slots.some((slot) => slot.number === parsed.data.slotNumber)
        ? `slotNumber must be one of ${facts.slots.map((slot) => slot.number).join(", ")}, or null.`
        : null;
  if (parsed.success && problem === null) return { ok: true, answer: parsed.data };
  return { ok: false, reply: [{ type: "tool_result", tool_use_id: call.id, is_error: true, content: `The answer did not validate. ${problem} Call answer_offer again.` }] };
}

export const NEGOTIATOR_FAILED = "did not answer this time, so the asking price stands";

/**
 * Asks the seller agent for one answer. An invalid answer gets one retry
 * with the validation error, and a second invalid answer, or a refusal,
 * leaves the offer unanswered so the asking price stands.
 */
export async function answerOffer(transport: NegotiatorTransport, facts: OfferFacts): Promise<AnswerResult> {
  const usage: OfferUsage = { ...NO_USAGE };
  const messages: BetaMessageParam[] = [{ role: "user", content: negotiationMessage(facts) }];
  for (const attempt of [1, 2] as const) {
    const reply = await transport.send(buildNegotiatorRequest(messages), attempt);
    usage.calls += 1;
    if (transport.mode === "live") {
      usage.inputTokens += reply.usage.input_tokens;
      usage.outputTokens += reply.usage.output_tokens;
      usage.cacheReadTokens += reply.usage.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens += reply.usage.cache_creation_input_tokens ?? 0;
    }
    if (reply.stop_reason === "refusal") return { ok: false, error: NEGOTIATOR_FAILED, usage };
    const reading = readAnswer(reply, facts);
    if (reading.ok) return { ok: true, answer: reading.answer, attempts: attempt, usage };
    messages.push({ role: "assistant", content: reply.content }, { role: "user", content: reading.reply });
  }
  return { ok: false, error: NEGOTIATOR_FAILED, usage };
}

export function liveNegotiatorTransport(apiKey: string): NegotiatorTransport {
  const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS });
  return { mode: "live", send: (request) => client.beta.messages.create(request) };
}
