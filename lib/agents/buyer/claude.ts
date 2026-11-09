import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { readConfig, readOptionalConfig } from "@/lib/config";
import type { AgentRunKind, ClaudeMode } from "@/lib/domain/enums";
import type { BuyerRequest, ClaudeTransport } from "./loop";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaContentBlock = Anthropic.Beta.Messages.BetaContentBlock;

/** Replies arrive at a steady pace, so the activity panel fills the way it does live. */
const REPLAY_DELAY_MS = 350;
/** The gap between tool calls inside one replayed reply, like blocks streaming in. */
const REPLAY_BLOCK_MS = 300;
const REQUEST_TIMEOUT_MS = 120_000;

/** A recorded conversation per run kind, in the order the API sent the replies. */
const recordingSchema = z.strictObject({
  version: z.literal(1),
  runs: z.strictObject({
    plan: z.array(z.looseObject({ type: z.literal("message"), content: z.array(z.unknown()) })),
    edit: z.array(z.looseObject({ type: z.literal("message"), content: z.array(z.unknown()) })),
  }),
});

type Recording = z.infer<typeof recordingSchema>;

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

export async function replayTransport(path: string, kind: AgentRunKind): Promise<ClaudeTransport> {
  const replies = (await readRecording(path)).runs[kind];
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

/** Passes every request through and saves each reply, replacing the earlier recording for this run kind. */
export function recordingTransport(inner: ClaudeTransport, path: string, kind: AgentRunKind): ClaudeTransport {
  const replies: BetaMessage[] = [];
  return {
    async send(request, onBlock) {
      const reply = await inner.send(request, onBlock);
      replies.push(reply);
      const existing = await readRecording(path).catch((): Recording => ({ version: 1, runs: { plan: [], edit: [] } }));
      const recording = { ...existing, runs: { ...existing.runs, [kind]: replies } };
      await writeFile(path, `${JSON.stringify(recording, null, 1)}\n`);
      return reply;
    },
  };
}

/** The transport for one run. A configured fixture always wins, so tests never reach the API. */
export async function transportFor(kind: AgentRunKind): Promise<{ mode: ClaudeMode; transport: ClaudeTransport }> {
  const fixture = readOptionalConfig("ROOMOVER_CLAUDE_FIXTURE");
  if (fixture !== undefined) return { mode: "fixture", transport: await replayTransport(fixture, kind) };
  const live = liveTransport(readConfig(["ANTHROPIC_API_KEY"]).ANTHROPIC_API_KEY);
  const record = readOptionalConfig("ROOMOVER_CLAUDE_RECORD");
  return { mode: "live", transport: record === undefined ? live : recordingTransport(live, record, kind) };
}

/** The mode a run will use, read before the run starts so rate limits know whether it spends Claude calls. */
export function claudeMode(): ClaudeMode {
  return readOptionalConfig("ROOMOVER_CLAUDE_FIXTURE") === undefined ? "live" : "fixture";
}
