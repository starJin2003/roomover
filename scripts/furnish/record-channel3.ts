import { readFile, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { compareWithNew } from "@/lib/agents/buyer/channel3-port";
import { liveChannel3Transport, channel3RecordingSchema } from "@/lib/channel3/transport";
import { readConfig } from "@/lib/config";
import { loadChannel3Search, loadRetailReferences } from "@/lib/db/channel3-searches";
import { getDb } from "@/lib/db/client";
import { loadCatalog } from "@/lib/db/plans";
import { agentEvents } from "@/lib/db/schema";
import { agentEventDetailSchema } from "@/lib/domain/agent-events";
import { CAMPUS } from "@/scripts/seed/campus";

/**
 * Gives every active listing a Channel3 new price (a query Channel3 answered
 * before costs nothing), then copies the text searches tests replay into
 * the Channel3 fixture: every listing's reference search and, with --plan,
 * every search that plan's runs made.
 *
 *   pnpm furnish:record-channel3 [--plan <planId>]
 */

const FIXTURE = "tests/fixtures/channel3.json";
const args = new Map(process.argv.slice(2).flatMap((value, index, all) => (value.startsWith("--") ? [[value.slice(2), all[index + 1]]] : [])));

async function main() {
  const db = getDb();
  const catalog = await loadCatalog(db, CAMPUS);
  const transport = liveChannel3Transport(readConfig(["CHANNEL3_API_KEY"]).CHANNEL3_API_KEY);
  const compared = await compareWithNew(
    { db, transport, now: () => new Date() },
    catalog.map((listing) => ({ id: listing.id, title: listing.title, category: listing.category, retailProductName: listing.retailProductName, matched: listing.matchedRetail })),
  );
  const references = await loadRetailReferences(db, catalog.map((listing) => listing.id));
  const keys = new Set([...references.values()].flatMap((row) => (row.queryKey === "matched" ? [] : [row.queryKey])));
  const plan = args.get("plan");
  if (plan !== undefined) {
    const events = await db.select({ detail: agentEvents.detail }).from(agentEvents).where(eq(agentEvents.planId, plan));
    for (const event of events) for (const key of agentEventDetailSchema.parse(event.detail).channel3?.keys ?? []) keys.add(key);
  }
  const recording = channel3RecordingSchema.parse(JSON.parse(await readFile(FIXTURE, "utf8")));
  const searches: Record<string, { products: unknown[] }> = { ...recording.searches };
  const missing: string[] = [];
  for (const key of [...keys].sort()) {
    const stored = await loadChannel3Search(db, key);
    if (stored === null) missing.push(key);
    else searches[key] = stored.response as { products: unknown[] };
  }
  await writeFile(FIXTURE, `${JSON.stringify({ ...recording, searches }, null, 1)}\n`);
  console.log(JSON.stringify({ listings: catalog.length, references: references.size, creditsSpent: compared.credits, searchesRecorded: Object.keys(searches).length, missing }, null, 2));
  process.exit(0);
}

void main();
