import { Channel3Error } from "@channel3/sdk";
import { RunLimitError } from "@/lib/agents/limits";
import type { Database } from "@/lib/db/client";
import { channel3SearchesToday, loadChannel3Lookup, storeChannel3Lookup } from "@/lib/db/sell";
import type { Channel3Lookup } from "@/lib/domain/sell";
import { decideChannel3Limit } from "./limits";
import { candidatesFrom } from "./products";
import type { Channel3Transport } from "./transport";

export interface IdentifyDeps {
  db: Database;
  transport: Channel3Transport;
  now: () => Date;
  sessionId: string;
}

/** Why Channel3 gave no answer, in a sentence the seller reads. */
export class Channel3Unavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Channel3Unavailable";
  }
}

/**
 * identify_product_by_image. Channel3 searches its catalog with the seller's
 * photo and returns the closest retail products with their new prices and
 * sizes. A photo searched before is answered from Postgres and costs no
 * credit, and a live search counts against the demo's Channel3 caps first.
 */
export async function identifyProductByImage(deps: IdentifyDeps, photo: { sha256: string; base64: string }): Promise<Channel3Lookup> {
  const started = Date.now();
  if (deps.transport.mode === "fixture") {
    const { candidates } = candidatesFrom(await deps.transport.searchByImage(photo.base64, photo.sha256));
    return { candidates, credits: 0, cached: false, latencyMs: Date.now() - started, unavailable: null };
  }

  const cached = await loadChannel3Lookup(deps.db, photo.sha256);
  if (cached !== null) return { candidates: cached.candidates, credits: 0, cached: true, latencyMs: Date.now() - started, unavailable: null };

  const now = deps.now();
  const decision = decideChannel3Limit(await channel3SearchesToday(deps.db, deps.sessionId, now), now);
  if (!decision.allowed) throw new RunLimitError(decision);

  let response: unknown;
  try {
    response = await deps.transport.searchByImage(photo.base64, photo.sha256);
  } catch (error) {
    console.error("channel3 image search failed", { error: error instanceof Error ? error.name : "unknown", status: error instanceof Channel3Error ? error.statusCode : undefined });
    throw new Channel3Unavailable("Channel3 did not answer just now, so Roomover could not look up the product. Try the photo again in a moment.");
  }
  const latencyMs = Date.now() - started;
  const { candidates, productCount } = candidatesFrom(response);
  await storeChannel3Lookup(deps.db, { imageSha256: photo.sha256, sessionId: deps.sessionId, candidates, productCount, credits: 1, latencyMs });
  return { candidates, credits: 1, cached: false, latencyMs, unavailable: null };
}
