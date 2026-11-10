import { writeFile } from "node:fs/promises";
import type Anthropic from "@anthropic-ai/sdk";
import { listingFacts, photoData, readPublicPhoto, sha256 } from "@/lib/agents/verifier/facts";
import { comparePhotos } from "@/lib/agents/verifier/compare";
import { readReplyRecording, type ReplyRecording } from "@/lib/agents/recording";
import { liveVerifierTransport } from "@/lib/agents/verifier/transport";
import { readConfig } from "@/lib/config";
import { damageWords } from "@/lib/domain/verdict";
import { samplesFor } from "@/lib/handoff/samples";
import { seedListings } from "../seed/listings";

/**
 * Runs the live verifier over every sample handoff photo, prints each
 * verdict next to the one expected, and saves the replies as the fixture
 * the e2e tests replay. Every sample should match its listing except the
 * torn chair, which should show new minor damage.
 *
 *   pnpm handoff:record-verifier [--out tests/fixtures/verifier-agent.json] [--only marcus-mesh-desk-chair]
 */

const args = new Map(process.argv.slice(2).flatMap((value, index, all) => (value.startsWith("--") ? [[value.slice(2), all[index + 1]]] : [])));
const OUT = args.get("out") ?? "tests/fixtures/verifier-agent.json";
const ONLY = args.get("only");
const CONCURRENCY = 3;

async function main() {
  const { ANTHROPIC_API_KEY } = readConfig(["ANTHROPIC_API_KEY"]);
  const live = liveVerifierTransport(ANTHROPIC_API_KEY);
  const jobs = seedListings("2026-11-08")
    .filter((listing) => ONLY === undefined || listing.photos[0].src.includes(ONLY))
    .flatMap((listing) => samplesFor(listing.photos[0].src).map((sample) => ({ listing, sample })));
  const rows: string[] = [];
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let misses = 0;

  const recorded = new Map<string, Anthropic.Beta.Messages.BetaMessage[]>();
  const run = async ({ listing, sample }: (typeof jobs)[number]) => {
    const handoff = await readPublicPhoto(sample.src);
    const listingPhotos = await Promise.all(listing.photos.map(async (photo) => photoData(await readPublicPhoto(photo.src), "image/jpeg")));
    const key = sha256(handoff);
    const started = Date.now();
    const result = await comparePhotos(
      {
        send: async (request, call) => {
          const reply = await live.send(request, call);
          recorded.set(key, [...(call === 1 ? [] : (recorded.get(key) ?? [])), reply]);
          return reply;
        },
      },
      listingFacts(listing),
      listingPhotos,
      photoData(handoff, "image/jpeg"),
    );
    calls += result.usage.calls;
    inputTokens += result.usage.inputTokens;
    outputTokens += result.usage.outputTokens;
    const expected = sample.kind === "torn" ? "new_damage" : "match";
    const got = result.ok ? result.verdict.verdict : "failed";
    if (got !== expected) misses += 1;
    const detail = result.ok ? `${result.verdict.damage === null ? "" : `${damageWords(result.verdict.damage)} on ${result.verdict.damage.location}, ${result.verdict.damage.severity}, `}${result.verdict.confidence}, ${result.attempts} call(s)` : result.error;
    rows.push(`${got === expected ? "ok  " : "MISS"} ${sample.src.padEnd(50)} ${got.padEnd(11)} ${((Date.now() - started) / 1000).toFixed(1)} s  ${detail}`);
    console.log(rows.at(-1));
  };

  const pending = [...jobs];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let job = pending.shift(); job !== undefined; job = pending.shift()) await run(job);
  }));
  const existing = await readReplyRecording(OUT).catch((): ReplyRecording => ({ version: 1, photos: {} }));
  const photos = Object.fromEntries(Object.entries({ ...existing.photos, ...Object.fromEntries(recorded) }).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(OUT, `${JSON.stringify({ ...existing, photos }, null, 1)}\n`);
  console.log(`\n${jobs.length} photos, ${misses} misses, ${calls} Claude calls, ${inputTokens} input and ${outputTokens} output tokens. Fixture: ${OUT}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
