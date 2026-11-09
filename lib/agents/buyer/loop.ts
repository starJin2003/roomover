import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AgentRunKind } from "@/lib/domain/enums";
import type { PlanLayout } from "@/lib/domain/layout";
import type { BuyerContext, EventDraft } from "./context";
import { editRequest, planRequest, systemBlocks } from "./prompt";
import { BUYER_TOOLS, toolByName, type BuyerTool } from "./tools";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
type ToolUse = Anthropic.Beta.Messages.BetaToolUseBlock;
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

/**
 * How Claude is reached. The live transport streams from the API, and the
 * fixture transport replays a recording. Both hand over each content block
 * the moment it is complete, before the whole reply has arrived.
 */
export interface ClaudeTransport {
  send(request: BuyerRequest, onBlock: (block: BetaContentBlock) => void): Promise<BetaMessage>;
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
 * Reads every run starts with. Code runs them before the first model call,
 * so the panel speaks within a moment of the start and the model skips a
 * turn. A plan run reads the rules and the room, and an edit run the room
 * with its floor map as it stands.
 */
const OPENING_READS: Readonly<Record<AgentRunKind, readonly string[]>> = {
  plan: ["get_hall_rules", "get_room_preset"],
  edit: ["get_room_preset"],
};

async function openingReads(context: BuyerContext, kind: AgentRunKind): Promise<{ events: EventDraft[]; text: string }> {
  const events: EventDraft[] = [];
  const sections: string[] = [];
  for (const name of OPENING_READS[kind]) {
    const tool = toolByName(name);
    if (tool === undefined) throw new Error(`The opening read ${name} is not a buyer tool.`);
    const outcome = await tool.run(context, {});
    // An edit keeps its own opening sentence, so its reads stay in the Details log.
    events.push(...(kind === "edit" ? outcome.events.map((event) => ({ ...event, sentence: undefined })) : outcome.events));
    sections.push(`<${name}>\n${json(outcome.result)}\n</${name}>`);
  }
  return { events, text: `Code already called ${OPENING_READS[kind].join(" and ")} for you. Their results:\n\n${sections.join("\n\n")}` };
}

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
  const reads = await openingReads(context, kind);
  await hooks.onEvents(reads.events);
  const messages: BetaMessageParam[] = [{ role: "user", content: `${opening}\n\n${reads.text}` }];
  let retried = false;

  /** Runs one tool call and reports whether its input was valid. */
  const runCall = async (call: ToolUse): Promise<{ result: ToolResult; valid: boolean }> => {
    const tool = toolByName(call.name);
    const parsed = tool?.input.safeParse(call.input);
    if (tool === undefined || parsed === undefined || !parsed.success) {
      const error = tool === undefined ? `There is no tool named ${call.name}.` : `Invalid input for ${call.name}. ${parsed?.success === false ? z.prettifyError(parsed.error) : ""}`;
      return { result: { type: "tool_result", tool_use_id: call.id, is_error: true, content: error }, valid: false };
    }
    const outcome = await tool.run(context, parsed.data);
    if (outcome.layout !== undefined) {
      context.layout = outcome.layout;
      await hooks.onLayout(outcome.layout);
    }
    if (outcome.events.length > 0) await hooks.onEvents(outcome.events);
    return { result: { type: "tool_result", tool_use_id: call.id, content: json(outcome.result) }, valid: true };
  };

  for (let turn = 0; turn < MAX_TURNS[kind]; turn++) {
    await hooks.beforeCall();
    // Each call runs as soon as its block streams in. Most run in the order the model wrote them, so items land one by one,
    // and concurrent ones (offers to different sellers) start at once so the room keeps filling while seller agents answer.
    const done = new Map<string, Promise<{ result: ToolResult; valid: boolean } | undefined>>();
    let queue = Promise.resolve();
    let failure: { error: unknown } | null = null;
    const guard = async (block: ToolUse) => {
      try {
        return failure === null ? await runCall(block) : undefined;
      } catch (error) {
        failure ??= { error };
        return undefined;
      }
    };
    const onBlock = (block: BetaContentBlock) => {
      if (block.type !== "tool_use") return;
      if (toolByName(block.name)?.concurrent === true) {
        done.set(block.id, guard(block));
        return;
      }
      const result = queue.then(() => guard(block));
      queue = result.then(() => undefined);
      done.set(block.id, result);
    };
    let response: BetaMessage;
    try {
      response = await transport.send(buildRequest(context, messages), onBlock);
    } finally {
      await Promise.all([queue, ...done.values()]);
    }
    if (failure !== null) throw (failure as { error: unknown }).error;
    await hooks.afterCall(usageOf(response));

    if (response.stop_reason === "refusal") {
      return { status: "failed", error: "The model declined to continue this plan." };
    }
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "pause_turn") continue;

    const calls = response.content.filter((block): block is ToolUse => block.type === "tool_use");
    if (calls.length === 0) {
      const final = response.stop_reason === "max_tokens" ? ({ ok: false, error: "Your reply was cut off. Reply with only the summary JSON." } as const) : parseFinal(response);
      if (final.ok) return { status: "succeeded", summary: final.summary };
      if (retried) return { status: "failed", error: "The buyer agent's reply did not match the expected format twice in a row." };
      retried = true;
      messages.push({ role: "user", content: final.error });
      continue;
    }

    const outcomes: { result: ToolResult; valid: boolean }[] = [];
    for (const call of calls) outcomes.push((await done.get(call.id)) ?? (await runCall(call)));
    const invalid = outcomes.some((outcome) => !outcome.valid);
    if (invalid && retried) return { status: "failed", error: "The buyer agent sent invalid tool input twice in a row." };
    retried = invalid;
    messages.push({ role: "user", content: outcomes.map((outcome) => outcome.result) });
  }
  return { status: "failed", error: `The buyer agent did not finish within ${MAX_TURNS[kind]} steps.` };
}
