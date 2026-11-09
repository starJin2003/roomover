import { readFile } from "node:fs/promises";
import { Channel3, type Channel3Api } from "@channel3/sdk";
import { z } from "zod";
import { readConfig, readOptionalConfig } from "@/lib/config";

/** How Channel3 is reached. The live transport calls it, and the fixture transport replays a recording. */
export interface Channel3Transport {
  readonly mode: "live" | "fixture";
  searchByImage(base64: string, photoSha256: string): Promise<unknown>;
  /** A text search with filters. The key names the query in a recording. */
  searchText(request: Channel3Api.SearchRequest, queryKey: string): Promise<unknown>;
}

/** Five products leave room for the four Sell keeps after dropping ones without a new US price. */
const SEARCH_LIMIT = 6;
const TIMEOUT_SECONDS = 20;

const recordedSearch = z.looseObject({ products: z.array(z.unknown()) });

/** Recorded image searches keyed by the photo's SHA-256, and text searches keyed by the query, as Channel3 answered them. */
export const channel3RecordingSchema = z.strictObject({
  version: z.literal(1),
  photos: z.record(z.string().regex(/^[0-9a-f]{64}$/), recordedSearch),
  searches: z.record(z.string().regex(/^[0-9a-f]{64}$/), recordedSearch).optional(),
});

export type Channel3Recording = z.infer<typeof channel3RecordingSchema>;

export async function readChannel3Recording(path: string): Promise<Channel3Recording> {
  return channel3RecordingSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export function liveChannel3Transport(apiKey: string): Channel3Transport {
  // One retry covers a dropped connection. The SDK retries 429 and 5xx answers with backoff.
  const client = new Channel3({ apiKey, timeoutInSeconds: TIMEOUT_SECONDS, maxRetries: 1 });
  return {
    mode: "live",
    async searchByImage(base64) {
      const page = await client.products.searchByImage({ base64_image: base64, limit: SEARCH_LIMIT, config: { country: "US", currency: "USD", length_unit: "cm" } });
      return page.response;
    },
    async searchText(request) {
      const page = await client.products.search(request);
      return page.response;
    },
  };
}

/** Replays the recorded search for one photo. A photo with no recording fails, so tests never reach Channel3. */
export function replayChannel3Transport(path: string): Channel3Transport {
  return {
    mode: "fixture",
    async searchByImage(_base64, photoSha256) {
      const recorded = (await readChannel3Recording(path)).photos[photoSha256];
      if (recorded === undefined) throw new Error(`The Channel3 recording has no search for photo ${photoSha256.slice(0, 12)}.`);
      return recorded;
    },
    async searchText(_request, queryKey) {
      const recorded = (await readChannel3Recording(path)).searches?.[queryKey];
      if (recorded === undefined) throw new Error(`The Channel3 recording has no text search ${queryKey.slice(0, 12)}.`);
      return recorded;
    },
  };
}

/** A configured fixture always wins, so tests never spend credits. */
export function channel3Transport(): Channel3Transport {
  const fixture = readOptionalConfig("ROOMOVER_CHANNEL3_FIXTURE");
  if (fixture !== undefined) return replayChannel3Transport(fixture);
  return liveChannel3Transport(readConfig(["CHANNEL3_API_KEY"]).CHANNEL3_API_KEY);
}
