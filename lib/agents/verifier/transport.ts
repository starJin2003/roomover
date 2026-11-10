import Anthropic from "@anthropic-ai/sdk";
import { replayDisputeReplies, replayReplies } from "@/lib/agents/recording";
import { readConfig, readOptionalConfig } from "@/lib/config";
import type { ClaudeMode } from "@/lib/domain/enums";
import type { VerifierTransport } from "./compare";

const REQUEST_TIMEOUT_MS = 90_000;

export function liveVerifierTransport(apiKey: string): VerifierTransport {
  const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS });
  return { send: (request) => client.beta.messages.create(request) };
}

/** Replays the recorded replies for one photo. A photo with no recording fails, so tests never fall through to the API. */
export async function replayVerifierTransport(path: string, photoSha256: string): Promise<VerifierTransport> {
  const reply = await replayReplies(path, photoSha256, "verifier");
  return { send: (_request, call) => reply(call) };
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

/** The transport for one dispute run. A configured fixture replays the run recorded for this listing and reason. */
export async function disputeTransportFor(key: string): Promise<{ mode: ClaudeMode; transport: VerifierTransport }> {
  const fixture = readOptionalConfig("ROOMOVER_VERIFIER_FIXTURE");
  if (fixture !== undefined) {
    const reply = await replayDisputeReplies(fixture, key);
    return { mode: "fixture", transport: { send: (_request, call) => reply(call) } };
  }
  return { mode: "live", transport: liveVerifierTransport(readConfig(["ANTHROPIC_API_KEY"]).ANTHROPIC_API_KEY) };
}
