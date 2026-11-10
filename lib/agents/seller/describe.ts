import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { replayReplies } from "@/lib/agents/recording";
import { strictSchema } from "@/lib/agents/strict-schema";
import type { PhotoData } from "@/lib/agents/verifier/prompt";
import { readConfig, readOptionalConfig } from "@/lib/config";
import type { ClaudeMode } from "@/lib/domain/enums";
import { sellerVerdictSchema, type SellerVerdict } from "@/lib/domain/sell";
import { SELLER_INSTRUCTIONS, sellerMessage, type CandidateForAgent } from "./prompt";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaTool = Anthropic.Beta.Messages.BetaTool;
type ToolUse = Anthropic.Beta.Messages.BetaToolUseBlock;
export type SellerRequest = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

export const SELLER_MODEL = "claude-sonnet-5-5";
/** Enough thought to compare a photo with four product photos, without the wait of a deeper pass. */
export const SELLER_EFFORT = "medium" as const;
const MAX_TOKENS = 8_000;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const TOOL_NAME = "describe_listing";
const REQUEST_TIMEOUT_MS = 90_000;

export interface SellerTransport {
  send(request: SellerRequest, call: number): Promise<BetaMessage>;
}

export const DESCRIBE_LISTING_TOOL: BetaTool = {
  name: TOOL_NAME,
  description:
    "Report the item in the seller's photo: its kind, a title, a description, its condition and visible defects, its main color and material, which Channel3 candidate is the same product (or null), and a used price and floor in whole dollars.",
  input_schema: strictSchema(z.toJSONSchema(sellerVerdictSchema)) as BetaTool["input_schema"],
  strict: true,
};

export function buildSellerRequest(messages: BetaMessageParam[]): SellerRequest {
  return {
    model: SELLER_MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: SELLER_EFFORT },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: SELLER_INSTRUCTIONS,
    tools: [DESCRIBE_LISTING_TOOL],
    // Sonnet 5.5 refuses forced tool choice, so the instructions name the tool and code checks it was called.
    tool_choice: { type: "auto" },
    messages,
  };
}

export interface DescribeUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export type DescribeResult =
  | { ok: true; verdict: SellerVerdict; model: string; attempts: 1 | 2; usage: DescribeUsage }
  | { ok: false; error: string; usage: DescribeUsage };

type Reading = { ok: true; verdict: SellerVerdict } | { ok: false; reply: Anthropic.Beta.Messages.BetaContentBlockParam[] };

/** Reads the verdict from a reply, or says what the model must fix on its one retry. */
function readVerdict(message: BetaMessage, candidateCount: number): Reading {
  const call = message.content.find((block): block is ToolUse => block.type === "tool_use" && block.name === TOOL_NAME);
  if (call === undefined) return { ok: false, reply: [{ type: "text", text: "You did not call describe_listing. Call it now." }] };
  const parsed = sellerVerdictSchema.safeParse(call.input);
  const problem = !parsed.success
    ? z.prettifyError(parsed.error)
    : parsed.data.matchedCandidate !== null && parsed.data.matchedCandidate > candidateCount
      ? `matchedCandidate must be a candidate number from 1 to ${candidateCount}, or null.`
      : null;
  if (parsed.success && problem === null) return { ok: true, verdict: parsed.data };
  return { ok: false, reply: [{ type: "tool_result", tool_use_id: call.id, is_error: true, content: `The listing did not validate. ${problem} Call describe_listing again with corrected values.` }] };
}

export const SELLER_FAILED = "The seller agent could not read this photo. Try again, or take a new photo of the item alone in good light.";
export const SELLER_REFUSED = "The seller agent declined this photo. Take a new photo of the item alone.";

/**
 * Describes one photo against the Channel3 candidates. An invalid answer
 * gets one retry with the validation error while the photo has calls left,
 * and a last invalid answer ends with a visible failure.
 */
export async function describeListing(transport: SellerTransport, photo: PhotoData, candidates: readonly CandidateForAgent[], maxCalls: number = 2): Promise<DescribeResult> {
  const usage: DescribeUsage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const messages: BetaMessageParam[] = [{ role: "user", content: sellerMessage(photo, candidates) }];
  for (const attempt of ([1, 2] as const).slice(0, Math.max(1, Math.min(2, maxCalls)))) {
    const reply = await transport.send(buildSellerRequest(messages), attempt);
    usage.calls += 1;
    usage.inputTokens += reply.usage.input_tokens + (reply.usage.cache_read_input_tokens ?? 0) + (reply.usage.cache_creation_input_tokens ?? 0);
    usage.outputTokens += reply.usage.output_tokens;
    if (reply.stop_reason === "refusal") return { ok: false, error: SELLER_REFUSED, usage };
    const reading = readVerdict(reply, candidates.length);
    if (reading.ok) return { ok: true, verdict: reading.verdict, model: reply.model, attempts: attempt, usage };
    messages.push({ role: "assistant", content: reply.content }, { role: "user", content: reading.reply });
  }
  return { ok: false, error: SELLER_FAILED, usage };
}

export function liveSellerTransport(apiKey: string): SellerTransport {
  const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS });
  return { send: (request) => client.beta.messages.create(request) };
}

/** The transport for one photo. A configured fixture always wins, so tests never reach the API. */
export async function sellerTransportFor(photoSha256: string): Promise<{ mode: ClaudeMode; transport: SellerTransport }> {
  const fixture = readOptionalConfig("ROOMOVER_SELLER_FIXTURE");
  if (fixture !== undefined) {
    const reply = await replayReplies(fixture, photoSha256, "seller agent");
    return { mode: "fixture", transport: { send: (_request, call) => reply(call) } };
  }
  return { mode: "live", transport: liveSellerTransport(readConfig(["ANTHROPIC_API_KEY"]).ANTHROPIC_API_KEY) };
}

export function sellerMode(): ClaudeMode {
  return readOptionalConfig("ROOMOVER_SELLER_FIXTURE") === undefined ? "live" : "fixture";
}
