import { readFile } from "node:fs/promises";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

/**
 * Recorded Claude replies for the one-photo agents (the verifier and the
 * seller agent), keyed by the photo's SHA-256 and kept in call order, so a
 * retry replays the second reply.
 */
export const replyRecordingSchema = z.strictObject({
  version: z.literal(1),
  photos: z.record(z.string().regex(/^[0-9a-f]{64}$/), z.array(z.looseObject({ type: z.literal("message"), content: z.array(z.unknown()) })).min(1).max(2)),
});

export type ReplyRecording = z.infer<typeof replyRecordingSchema>;

export async function readReplyRecording(path: string): Promise<ReplyRecording> {
  return replyRecordingSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

/** A replayed call takes a moment, so the screen shows its waiting state the way it does live. */
const REPLAY_DELAY_MS = 900;

/** The recorded replies for one photo. A photo with no recording fails, so tests never fall through to the API. */
export async function replayReplies(path: string, photoSha256: string, agent: string): Promise<(call: number) => Promise<BetaMessage>> {
  const replies = (await readReplyRecording(path)).photos[photoSha256];
  return async (call) => {
    const reply = replies?.[call - 1] as unknown as BetaMessage | undefined;
    if (reply === undefined) throw new Error(`The ${agent} recording has no reply ${call} for photo ${photoSha256.slice(0, 12)}.`);
    await new Promise((resolve) => setTimeout(resolve, REPLAY_DELAY_MS));
    return reply;
  };
}
