import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { readConfig, readOptionalConfig } from "@/lib/config";
import type { AgentRunKind, ClaudeMode } from "@/lib/domain/enums";
import type { BuyerRequest, ClaudeTransport } from "./loop";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

/** Replies arrive at a steady pace, so the activity panel fills the way it does live. */
const REPLAY_DELAY_MS = 350;
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
  return { send: (request: BuyerRequest) => client.beta.messages.create(request) };
}

async function readRecording(path: string): Promise<Recording> {
  return recordingSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export async function replayTransport(path: string, kind: AgentRunKind): Promise<ClaudeTransport> {
  const replies = (await readRecording(path)).runs[kind];
  let next = 0;
  return {
    async send() {
      const reply = replies[next];
      if (reply === undefined) throw new Error(`The recorded ${kind} conversation has no reply ${next + 1}.`);
      next += 1;
      await new Promise((resolve) => setTimeout(resolve, REPLAY_DELAY_MS));
      return reply as unknown as BetaMessage;
    },
  };
}

/** Passes every request through and saves each reply, replacing the earlier recording for this run kind. */
export function recordingTransport(inner: ClaudeTransport, path: string, kind: AgentRunKind): ClaudeTransport {
  const replies: BetaMessage[] = [];
  return {
    async send(request) {
      const reply = await inner.send(request);
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
