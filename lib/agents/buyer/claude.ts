import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { readConfig, readOptionalConfig } from "@/lib/config";
import { liveNegotiatorTransport, type NegotiatorTransport } from "@/lib/agents/seller/negotiate";
import type { AgentRunKind, ClaudeMode } from "@/lib/domain/enums";
import type { BuyerRequest, ClaudeTransport } from "./loop";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaContentBlock = Anthropic.Beta.Messages.BetaContentBlock;

/** Replies arrive at a steady pace, so the activity panel fills the way it does live. */
const REPLAY_DELAY_MS = 350;
/** The gap between tool calls inside one replayed reply, like blocks streaming in. */
const REPLAY_BLOCK_MS = 300;
const REQUEST_TIMEOUT_MS = 120_000;

const messageSchema = z.looseObject({ type: z.literal("message"), content: z.array(z.unknown()) });

/**
 * A recorded conversation per run kind, in the order the API sent the
 * replies. A plan run in a room with its own scenario replays that one, and
 * the seller agent's answers sit beside them, keyed by the offer they answer.
 */
const recordingSchema = z.strictObject({
  version: z.literal(1),
  runs: z.strictObject({ plan: z.array(messageSchema), edit: z.array(messageSchema) }),
  scenarios: z.record(z.string().min(1), z.array(messageSchema)).optional(),
  offers: z.record(z.string().regex(/^[0-9a-f]{64}$/), z.array(messageSchema).min(1).max(2)).optional(),
});

type Recording = z.infer<typeof recordingSchema>;

const asRecorded = (replies: readonly BetaMessage[]) => replies as unknown as Recording["runs"]["plan"];

/** Parallel negotiations record at once, so writes to one recording take turns. */
let writes: Promise<void> = Promise.resolve();

function updateRecording(path: string, change: (recording: Recording) => Recording): Promise<void> {
  const next = writes.then(async () => {
    const existing = await readRecording(path).catch((): Recording => ({ version: 1, runs: { plan: [], edit: [] } }));
    await writeFile(path, `${JSON.stringify(change(existing), null, 1)}\n`);
  });
  writes = next.catch(() => undefined);
  return next;
}

export function liveTransport(apiKey: string): ClaudeTransport {
  const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS });
  return {
    send(request: BuyerRequest, onBlock) {
      const stream = client.beta.messages.stream(request);
      stream.on("contentBlock", onBlock);
      return stream.finalMessage();
    },
  };
}

async function readRecording(path: string): Promise<Recording> {
  return recordingSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export async function replayTransport(path: string, kind: AgentRunKind, scenario?: string): Promise<ClaudeTransport> {
  const recording = await readRecording(path);
  const replies = (kind === "plan" && scenario !== undefined ? recording.scenarios?.[scenario] : undefined) ?? recording.runs[kind];
  let next = 0;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    async send(_request, onBlock) {
      const reply = replies[next] as unknown as BetaMessage | undefined;
      if (reply === undefined) throw new Error(`The recorded ${kind} conversation has no reply ${next + 1}.`);
      next += 1;
      await wait(REPLAY_DELAY_MS);
      let first = true;
      for (const block of reply.content as BetaContentBlock[]) {
        if (block.type === "tool_use" && !first) await wait(REPLAY_BLOCK_MS);
        if (block.type === "tool_use") first = false;
        onBlock(block);
      }
      return reply;
    },
  };
}

/**
 * Passes every request through and saves each reply, replacing the earlier
 * recording for this run. A plan run records as its room's scenario, and an
 * edit run as the edit conversation.
 */
export function recordingTransport(inner: ClaudeTransport, path: string, kind: AgentRunKind, scenario?: string): ClaudeTransport {
  const replies: BetaMessage[] = [];
  return {
    async send(request, onBlock) {
      const reply = await inner.send(request, onBlock);
      replies.push(reply);
      await updateRecording(path, (existing) =>
        kind === "plan" && scenario !== undefined
          ? { ...existing, scenarios: { ...existing.scenarios, [scenario]: asRecorded(replies) } }
          : { ...existing, runs: { ...existing.runs, [kind]: asRecorded(replies) } },
      );
      return reply;
    },
  };
}

/** The transport for one run. A replay or a configured fixture always wins, so tests and replays never reach the API. */
export async function transportFor(kind: AgentRunKind, scenario?: string, replay?: string): Promise<{ mode: ClaudeMode; transport: ClaudeTransport }> {
  const fixture = replay ?? readOptionalConfig("ROOMOVER_CLAUDE_FIXTURE");
  if (fixture !== undefined) return { mode: "fixture", transport: await replayTransport(fixture, kind, scenario) };
  const live = liveTransport(readConfig(["ANTHROPIC_API_KEY"]).ANTHROPIC_API_KEY);
  const record = readOptionalConfig("ROOMOVER_CLAUDE_RECORD");
  return { mode: "live", transport: record === undefined ? live : recordingTransport(live, record, kind, scenario) };
}

/** A seller agent's answers for one offer, replayed from or saved to the buyer's recording under the offer's key. */
export interface OfferTransports {
  readonly mode: "live" | "fixture";
  forOffer(key: string): NegotiatorTransport;
}

const REPLAY_OFFER_MS = 600;

/** Seller agents for one run. Recorded answers come back by the offer's key, so parallel negotiations replay in any order. */
export async function offerTransportsFor(replay?: string): Promise<OfferTransports> {
  const fixture = replay ?? readOptionalConfig("ROOMOVER_CLAUDE_FIXTURE");
  if (fixture !== undefined) {
    const offers = (await readRecording(fixture)).offers ?? {};
    return {
      mode: "fixture",
      forOffer: (key) => ({
        mode: "fixture",
        async send(_request, call) {
          const reply = offers[key]?.[call - 1] as unknown as BetaMessage | undefined;
          if (reply === undefined) throw new Error(`The recording has no seller agent answer ${call} for offer ${key.slice(0, 12)}.`);
          await new Promise((resolve) => setTimeout(resolve, REPLAY_OFFER_MS));
          return reply;
        },
      }),
    };
  }
  const live = liveNegotiatorTransport(readConfig(["ANTHROPIC_API_KEY"]).ANTHROPIC_API_KEY);
  const record = readOptionalConfig("ROOMOVER_CLAUDE_RECORD");
  return {
    mode: "live",
    forOffer: (key) =>
      record === undefined
        ? live
        : {
            mode: "live",
            async send(request, call) {
              const reply = await live.send(request, call);
              await updateRecording(record, (existing) => {
                const earlier = call === 1 ? [] : (existing.offers?.[key] ?? []).slice(0, call - 1);
                return { ...existing, offers: { ...existing.offers, [key]: [...earlier, ...asRecorded([reply])] } };
              });
              return reply;
            },
          },
  };
}

/** The mode a run will use, read before the run starts so rate limits know whether it spends Claude calls. */
export function claudeMode(): ClaudeMode {
  return readOptionalConfig("ROOMOVER_CLAUDE_FIXTURE") === undefined ? "live" : "fixture";
}
