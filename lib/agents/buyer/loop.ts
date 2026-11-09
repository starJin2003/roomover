import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AgentRunKind } from "@/lib/domain/enums";
import type { PlanLayout } from "@/lib/domain/layout";
import type { BuyerContext, EventDraft } from "./context";
import { editRequest, planRequest, systemBlocks } from "./prompt";
import { BUYER_TOOLS, toolByName, type BuyerTool } from "./tools";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaTool = Anthropic.Beta.Messages.BetaTool;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;
export type BuyerRequest = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

export const BUYER_MODEL = "claude-sonnet-5-5";
/** Fewer, more consolidated tool calls than `high`, with enough thought for placement. */
export const BUYER_EFFORT = "medium" as const;
const MAX_TOKENS = 16_000;
/** On a policy decline the API retries on its default fallback model inside the same call. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export const MAX_TURNS: Readonly<Record<AgentRunKind, number>> = { plan: 30, edit: 12 };

/** How Claude is reached. The live transport calls the API, and the fixture transport replays a recording. */
export interface ClaudeTransport {
  send(request: BuyerRequest): Promise<BetaMessage>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export interface LoopHooks {
  /** Runs before every Claude call, so a spent daily allowance stops the run. Throwing ends the run. */
  beforeCall(): Promise<void>;
  afterCall(usage: Usage): Promise<void>;
  onEvents(events: EventDraft[]): Promise<void>;
  onLayout(layout: PlanLayout): Promise<void>;
}

export type LoopResult = { status: "succeeded"; summary: string } | { status: "failed"; error: string };

/** The JSON the model ends every run with. */
export const finalReplySchema = z.strictObject({ summary: z.string().min(1).max(400) });

function toolDefinition(tool: BuyerTool): BetaTool {
  const schema = { ...(z.toJSONSchema(tool.input) as Record<string, unknown>) };
  delete schema.$schema;
  return { name: tool.name, description: tool.description, input_schema: schema as BetaTool["input_schema"] };
}

export const BUYER_TOOL_DEFINITIONS: readonly BetaTool[] = BUYER_TOOLS.map(toolDefinition);

export function buildRequest(context: BuyerContext, messages: BetaMessageParam[]): BuyerRequest {
  return {
    model: BUYER_MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: BUYER_EFFORT },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: systemBlocks(context),
    tools: [...BUYER_TOOL_DEFINITIONS],
    // Caches the conversation so far, on top of the two breakpoints in the system prompt.
    cache_control: { type: "ephemeral" },
    messages,
  };
}

function usageOf(message: BetaMessage): Usage {
  return {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
  };
}

/** The last text block, with any prose around a JSON object trimmed away. */
function finalText(message: BetaMessage): string {
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).at(-1) ?? "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

function parseFinal(message: BetaMessage): { ok: true; summary: string } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(finalText(message));
  } catch {
    return { ok: false, error: 'Your last reply was not JSON. Reply with only {"summary": "..."}.' };
  }
  const parsed = finalReplySchema.safeParse(json);
  return parsed.success ? { ok: true, summary: parsed.data.summary } : { ok: false, error: `Your last reply did not match {"summary": "..."}. ${z.prettifyError(parsed.error)}` };
}

const json = (value: unknown) => JSON.stringify(value);

/**
 * Runs the buyer agent until it replies with its summary. The history only
 * ever grows, so cached turns and thinking blocks stay valid. A tool call
 * with invalid input, or a final reply that fails its schema, gets the
 * validation error back once. A second invalid output in a row ends the run.
 */
export async function runBuyerLoop(options: {
  transport: ClaudeTransport;
  context: BuyerContext;
  kind: AgentRunKind;
  request?: string;
  hooks: LoopHooks;
}): Promise<LoopResult> {
  const { transport, context, kind, hooks } = options;
  const opening = kind === "edit" ? editRequest(context, options.request ?? "") : planRequest(context);
  const messages: BetaMessageParam[] = [{ role: "user", content: opening }];
  let retried = false;

  for (let turn = 0; turn < MAX_TURNS[kind]; turn++) {
    await hooks.beforeCall();
    const response = await transport.send(buildRequest(context, messages));
    await hooks.afterCall(usageOf(response));

    if (response.stop_reason === "refusal") {
      return { status: "failed", error: "The model declined to continue this plan." };
    }
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "pause_turn") continue;

    const calls = response.content.filter((block): block is Anthropic.Beta.Messages.BetaToolUseBlock => block.type === "tool_use");
    if (calls.length === 0) {
      const final = response.stop_reason === "max_tokens" ? ({ ok: false, error: "Your reply was cut off. Reply with only the summary JSON." } as const) : parseFinal(response);
      if (final.ok) return { status: "succeeded", summary: final.summary };
      if (retried) return { status: "failed", error: "The buyer agent's reply did not match the expected format twice in a row." };
      retried = true;
      messages.push({ role: "user", content: final.error });
      continue;
    }

    const results: ToolResult[] = [];
    let invalid = false;
    for (const call of calls) {
      const tool = toolByName(call.name);
      const parsed = tool?.input.safeParse(call.input);
      if (tool === undefined || parsed === undefined || !parsed.success) {
        invalid = true;
        const error = tool === undefined ? `There is no tool named ${call.name}.` : `Invalid input for ${call.name}. ${parsed?.success === false ? z.prettifyError(parsed.error) : ""}`;
        results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: error });
        continue;
      }
      const outcome = tool.run(context, parsed.data);
      if (outcome.layout !== undefined) {
        context.layout = outcome.layout;
        await hooks.onLayout(outcome.layout);
      }
      if (outcome.events.length > 0) await hooks.onEvents(outcome.events);
      results.push({ type: "tool_result", tool_use_id: call.id, content: json(outcome.result) });
    }
    if (invalid && retried) return { status: "failed", error: "The buyer agent sent invalid tool input twice in a row." };
    retried = invalid;
    messages.push({ role: "user", content: results });
  }
  return { status: "failed", error: `The buyer agent did not finish within ${MAX_TURNS[kind]} steps.` };
}
