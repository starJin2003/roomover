import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { verdictInputSchema, verdictSchema, type VerdictInput } from "@/lib/domain/verdict";
import { comparisonMessage, VERIFIER_INSTRUCTIONS, type ListingFacts, type PhotoData } from "./prompt";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaTool = Anthropic.Beta.Messages.BetaTool;
type ToolUse = Anthropic.Beta.Messages.BetaToolUseBlock;
export type VerifierRequest = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

export const VERIFIER_MODEL = "claude-sonnet-5-5";
/** Enough thought to look closely at two photos, without the wait of a deeper pass. */
export const VERIFIER_EFFORT = "medium" as const;
const MAX_TOKENS = 8_000;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const TOOL_NAME = "compare_photos";

/** How Claude is reached. The live transport calls the API, and the fixture transport replays a recording. */
export interface VerifierTransport {
  send(request: VerifierRequest, call: number): Promise<BetaMessage>;
}

/** Strict tool schemas accept no length or range keywords, so zod checks those after the call. */
const UNSUPPORTED_KEYWORDS = new Set(["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "$schema"]);

export function strictSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strictSchema);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => (UNSUPPORTED_KEYWORDS.has(key) ? [] : [[key, strictSchema(entry)]])));
}

export const COMPARE_PHOTOS_TOOL: BetaTool = {
  name: TOOL_NAME,
  description:
    "Report the verdict after comparing the buyer's handoff photo with the seller's listing photos. Set damage only for a new_damage verdict, and set it to null otherwise.",
  input_schema: strictSchema(z.toJSONSchema(verdictInputSchema)) as BetaTool["input_schema"],
  strict: true,
};

export function buildVerifierRequest(messages: BetaMessageParam[]): VerifierRequest {
  return {
    model: VERIFIER_MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: VERIFIER_EFFORT },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: VERIFIER_INSTRUCTIONS,
    tools: [COMPARE_PHOTOS_TOOL],
    // Sonnet 5.5 refuses forced tool choice, so the instructions name the tool and code checks it was called.
    tool_choice: { type: "auto" },
    messages,
  };
}

export interface ComparisonUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export type ComparisonResult =
  | { ok: true; verdict: VerdictInput; model: string; attempts: 1 | 2; usage: ComparisonUsage }
  | { ok: false; error: string; usage: ComparisonUsage };

type Reading = { ok: true; verdict: VerdictInput } | { ok: false; reply: Anthropic.Beta.Messages.BetaContentBlockParam[] };

/** Reads the verdict from a reply, or says what the model must fix on its one retry. */
function readVerdict(message: BetaMessage): Reading {
  const call = message.content.find((block): block is ToolUse => block.type === "tool_use" && block.name === TOOL_NAME);
  if (call === undefined) {
    return { ok: false, reply: [{ type: "text", text: "You did not call compare_photos. Call it now with your verdict." }] };
  }
  const parsed = verdictSchema.safeParse(call.input);
  if (parsed.success) return { ok: true, verdict: parsed.data };
  return {
    ok: false,
    reply: [{ type: "tool_result", tool_use_id: call.id, is_error: true, content: `The verdict did not validate. ${z.prettifyError(parsed.error)} Call compare_photos again with a corrected verdict.` }],
  };
}

export const VERIFIER_FAILED = "The verifier could not read this photo. Try again, or take a new photo in brighter light.";
export const VERIFIER_REFUSED = "The verifier declined to compare this photo. Take a new photo of the item alone.";

/**
 * Compares the listing photos with one handoff photo. An invalid verdict
 * gets one retry with the validation error, and a second invalid verdict
 * ends with a visible failure the student can retry.
 */
export async function comparePhotos(transport: VerifierTransport, listing: ListingFacts, listingPhotos: readonly PhotoData[], handoffPhoto: PhotoData): Promise<ComparisonResult> {
  const usage: ComparisonUsage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const messages: BetaMessageParam[] = [{ role: "user", content: comparisonMessage(listing, listingPhotos, handoffPhoto) }];
  for (const attempt of [1, 2] as const) {
    const reply = await transport.send(buildVerifierRequest(messages), attempt);
    usage.calls += 1;
    usage.inputTokens += reply.usage.input_tokens + (reply.usage.cache_read_input_tokens ?? 0) + (reply.usage.cache_creation_input_tokens ?? 0);
    usage.outputTokens += reply.usage.output_tokens;
    if (reply.stop_reason === "refusal") return { ok: false, error: VERIFIER_REFUSED, usage };
    const reading = readVerdict(reply);
    if (reading.ok) return { ok: true, verdict: reading.verdict, model: reply.model, attempts: attempt, usage };
    messages.push({ role: "assistant", content: reply.content }, { role: "user", content: reading.reply });
  }
  return { ok: false, error: VERIFIER_FAILED, usage };
}
