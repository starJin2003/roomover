import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import type { BuyerContext, NegotiationPort } from "@/lib/agents/buyer/context";
import { toolByName, type ToolOutcome } from "@/lib/agents/buyer/tools";
import type { AnswerOffer } from "@/lib/agents/seller/negotiate";
import { LISTING_CATEGORIES } from "@/lib/domain/enums";
import type { McpDeps } from "@/mcp/deps";
import { buildMcpServer } from "@/mcp/server";
import { CAMPUS, UNIVERSITY } from "@/scripts/seed/campus";
import { harborContext, listingId, seedCatalog } from "./support/buyer-context";

/**
 * A seller's floor is the least their agent may take, and only the seller
 * and code know it. No buyer agent tool result, activity line, or MCP
 * result may carry it, even when the seller agent tries to give it away.
 */

/** Floor price wording, apart from furniture that stands on the floor (placement "floor", a floor lamp). */
const FLOOR_TALK = /floor ?price|floor_price|floorCents|seller'?s floor|\b(?:my|your|a|its) floor\b(?! lamp)|(?:under|at|above|below|over) the floor|lowest you/i;

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
}

function expectNoFloor(value: unknown, floors: readonly string[] = []): void {
  const text = JSON.stringify(value);
  expect(keysOf(value).filter((key) => /floor_?(price|cents|dollars)/i.test(key))).toEqual([]);
  expect(text).not.toMatch(FLOOR_TALK);
  for (const floor of floors) expect(text).not.toContain(floor);
}

/** Seller agents that try every way to give the floor away: accepting under it, naming it, and hinting at it. */
function leakyNegotiator(script: AnswerOffer[]): NegotiationPort {
  return {
    async answer() {
      const answer = script.shift() ?? { action: "decline", counterDollars: null, slotNumber: null, message: "My floor is $40, sorry." };
      return { ok: true, answer, attempts: 1, usage: { calls: 1, inputTokens: 900, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0 }, latencyMs: 1 };
    },
    async save() {},
  };
}

async function call(context: BuyerContext, name: string, input: unknown): Promise<ToolOutcome> {
  const tool = toolByName(name);
  if (tool === undefined) throw new Error(`No tool ${name}.`);
  const outcome = await tool.run(context, tool.input.parse(input));
  if (outcome.layout !== undefined) context.layout = outcome.layout;
  return outcome;
}

const DESK = listingId("jun-white-desk");
const MONDAY_2PM = { windowDay: 2, startHour: 14 };

describe("the seller's floor stays private", () => {
  it("never reaches a search result, a room or rules read, or any activity line", async () => {
    const context = harborContext();
    const outcomes = [await call(context, "search_listings", { limit: 24 }), await call(context, "get_room_preset", {}), await call(context, "get_hall_rules", {})];
    for (const category of LISTING_CATEGORIES) outcomes.push(await call(context, "search_listings", { category, limit: 24 }));
    for (const outcome of outcomes) {
      expectNoFloor(outcome.result);
      expectNoFloor(outcome.events);
    }
  });

  it("never reaches the buyer agent or the panel through a negotiation, whatever the seller agent says", async () => {
    // The desk asks $55 and its floor is $40. The buyer offers $30, $42, $44, then answers the counter.
    const context = harborContext({
      negotiator: leakyNegotiator([
        { action: "accept", counterDollars: null, slotNumber: null, message: "Deal, even though $30 is under my floor of $40." },
        { action: "counter", counterDollars: 46, slotNumber: null, message: "The lowest I can go is $40, so $46." },
        { action: "counter", counterDollars: 38, slotNumber: null, message: "Fine, $38, just under my floor." },
      ]),
    });
    const outcomes = [
      await call(context, "make_offer", { listingIds: [DESK], priceDollars: 30, slot: MONDAY_2PM }),
      await call(context, "make_offer", { listingIds: [DESK], priceDollars: 42, slot: MONDAY_2PM }),
      await call(context, "make_offer", { listingIds: [DESK], priceDollars: 44, slot: MONDAY_2PM }),
    ];
    outcomes.push(await call(context, "respond_to_offer", { listingIds: [DESK], action: "accept" }));
    for (const outcome of outcomes) {
      expectNoFloor(outcome.result, ["$40"]);
      expectNoFloor(outcome.events, ["$40"]);
    }
    const answers = outcomes.slice(0, 3).map((outcome) => outcome.result as { answer: string; priceDollars?: number });
    // Under the floor, code counters at the asking price, never at the floor.
    expect(answers.map((answer) => [answer.answer, answer.priceDollars])).toEqual([
      ["counter", 55],
      ["counter", 46],
      ["counter", 55],
    ]);
  });

  it("never reaches an MCP result", async () => {
    const deps: McpDeps = {
      searchScope: async () => ({ campusSlug: CAMPUS, campusName: UNIVERSITY, room: null, roomLabel: null, appUrl: "https://roomover.example" }),
      catalog: async () => ({ catalog: seedCatalog(), extras: new Map() }),
      presets: async () => [],
      demoRoom: () => ({ presetSlug: "harbor-hall-double", label: "Harbor Hall 214", student: "Jordan Ellis," }),
      planRoom: () => ({}) as ReturnType<McpDeps["planRoom"]>,
      createCheckout: () => ({ appUrl: "https://roomover.example", ownPlan: async () => null, prepare: async () => ({ ok: false, message: "unused" }) }),
      recordCall: async () => undefined,
    };
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await buildMcpServer(deps, { buyerSession: "mcp-abcdefghijklmnopqrst", clientHash: "hash", fromAnthropic: false, logRunId: "11111111-1111-4111-8111-111111111111" }).connect(serverSide);
    const client = new Client({ name: "floor-check", version: "1.0.0" });
    await client.connect(clientSide);
    const results = [
      await client.callTool({ name: "search_listings", arguments: {} }),
      await client.callTool({ name: "search_listings", arguments: { maxPriceDollars: 20 } }),
      await client.callTool({ name: "get_room_presets", arguments: {} }),
    ];
    for (const result of results) {
      expect(result.isError).not.toBe(true);
      expectNoFloor(result);
    }
    const listings = (results[0].structuredContent as { listings: unknown[] }).listings;
    expect(listings.length).toBeGreaterThan(10);
    await client.close();
  });
});
