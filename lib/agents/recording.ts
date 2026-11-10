import { readFile } from "node:fs/promises";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

/**
 * Recorded Claude replies for the one-photo agents (the verifier and the
 * seller agent), keyed by the photo's SHA-256 and kept in call order, so a
 * retry replays the second reply.
 */
const recordedMessage = z.looseObject({ type: z.literal("message"), content: z.array(z.unknown()) });

export const replyRecordingSchema = z.strictObject({
  version: z.literal(1),
  photos: z.record(z.string().regex(/^[0-9a-f]{64}$/), z.array(recordedMessage).min(1).max(2)),
  /** The verifier's dispute runs, keyed by the disputed listing and PayPal's reason, in call order. */
  disputes: z.record(z.string().regex(/^[0-9a-f-]{36}:[A-Z_]+$/), z.array(recordedMessage).min(1).max(5)).optional(),
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

/** The key a dispute run is recorded under: the disputed listing and PayPal's reason, which stay the same on any day. */
export const disputeRecordingKey = (listingId: string, reason: string) => `${listingId}:${reason}`;

/** The recorded replies of one dispute run. A run with no recording fails, so tests never fall through to the API. */
export async function replayDisputeReplies(path: string, key: string): Promise<(call: number) => Promise<BetaMessage>> {
  const replies = (await readReplyRecording(path)).disputes?.[key];
  return async (call) => {
    const reply = replies?.[call - 1] as unknown as BetaMessage | undefined;
    if (reply === undefined) throw new Error(`The verifier recording has no dispute reply ${call} for ${key}.`);
    await new Promise((resolve) => setTimeout(resolve, REPLAY_DELAY_MS));
    return reply;
  };
}
