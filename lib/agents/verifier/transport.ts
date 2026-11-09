import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { readConfig, readOptionalConfig } from "@/lib/config";
import type { ClaudeMode } from "@/lib/domain/enums";
import type { VerifierTransport } from "./compare";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

const REQUEST_TIMEOUT_MS = 90_000;
/** A replayed comparison takes a moment, so the screen shows its waiting state the way it does live. */
const REPLAY_DELAY_MS = 900;

/** Recorded replies per handoff photo, keyed by the photo's SHA-256, in call order. */
export const verifierRecordingSchema = z.strictObject({
  version: z.literal(1),
  photos: z.record(z.string().regex(/^[0-9a-f]{64}$/), z.array(z.looseObject({ type: z.literal("message"), content: z.array(z.unknown()) })).min(1).max(2)),
});

export type VerifierRecording = z.infer<typeof verifierRecordingSchema>;

export async function readVerifierRecording(path: string): Promise<VerifierRecording> {
  return verifierRecordingSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export function liveVerifierTransport(apiKey: string): VerifierTransport {
  const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS });
  return { send: (request) => client.beta.messages.create(request) };
}

/** Replays the recorded replies for one photo. A photo with no recording fails, so tests never fall through to the API. */
export async function replayVerifierTransport(path: string, photoSha256: string): Promise<VerifierTransport> {
  const replies = (await readVerifierRecording(path)).photos[photoSha256];
  return {
    async send(_request, call) {
      const reply = replies?.[call - 1] as unknown as BetaMessage | undefined;
      if (reply === undefined) throw new Error(`The verifier recording has no reply ${call} for photo ${photoSha256.slice(0, 12)}.`);
      await new Promise((resolve) => setTimeout(resolve, REPLAY_DELAY_MS));
      return reply;
    },
  };
}

export function verifierMode(): ClaudeMode {
  return readOptionalConfig("ROOMOVER_VERIFIER_FIXTURE") === undefined ? "live" : "fixture";
}

/** The transport for one comparison. A configured fixture always wins, so tests never reach the API. */
export async function verifierTransportFor(photoSha256: string): Promise<{ mode: ClaudeMode; transport: VerifierTransport }> {
  const fixture = readOptionalConfig("ROOMOVER_VERIFIER_FIXTURE");
  if (fixture !== undefined) return { mode: "fixture", transport: await replayVerifierTransport(fixture, photoSha256) };
  return { mode: "live", transport: liveVerifierTransport(readConfig(["ANTHROPIC_API_KEY"]).ANTHROPIC_API_KEY) };
}
