import { describe, expect, it } from "vitest";
import type { BuyerContext, NegotiationPort, NegotiationRecord, NewProductPort } from "@/lib/agents/buyer/context";
import { planTotalCents } from "@/lib/agents/buyer/context";
import { offerKey } from "@/lib/agents/buyer/negotiation";
import { toolByName, type ToolOutcome } from "@/lib/agents/buyer/tools";
import type { AnswerOffer } from "@/lib/agents/seller/negotiate";
import type { OfferFacts } from "@/lib/agents/seller/negotiate-prompt";
import type { NewProduct } from "@/lib/channel3/search";
import { campusInstant } from "@/lib/domain/handoff-slots";
import { harborContext, listingId } from "./support/buyer-context";

const DESK = listingId("jun-white-desk");
const CHAIR = listingId("jun-velvet-side-chair");
const LAMP = listingId("ava-desk-lamp");
const BEAN_BAG = listingId("lea-navy-bean-bag");
const KILIM = listingId("lea-kilim-rug");
const MONDAY_2PM = { windowDay: 2, startHour: 14 };

interface FakeNegotiator extends NegotiationPort {
  saved: NegotiationRecord[][];
  asked: { key: string; facts: OfferFacts; startedAt: number; endedAt: number }[];
}

/** Seller agents that answer from a script, each after a short wait, so overlapping offers show. */
function negotiator(answers: (facts: OfferFacts) => AnswerOffer | null, waitMs = 20): FakeNegotiator {
  const port: FakeNegotiator = {
    saved: [],
    asked: [],
    async answer(key, facts) {
      const startedAt = Date.now();
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      port.asked.push({ key, facts, startedAt, endedAt: Date.now() });
      const answer = answers(facts);
      const usage = { calls: 1, inputTokens: 900, outputTokens: 60, cacheReadTokens: 700, cacheWriteTokens: 0 };
      return answer === null ? { ok: false, error: "no", usage, latencyMs: waitMs } : { ok: true, answer, attempts: 1, usage, latencyMs: waitMs };
    },
    async save(records) {
      port.saved.push(records);
    },
  };
  return port;
}

const accept: AnswerOffer = { action: "accept", counterDollars: null, slotNumber: null, message: "Deal at your price." };
const counter = (dollars: number): AnswerOffer => ({ action: "counter", counterDollars: dollars, slotNumber: null, message: `Could you do $${dollars}?` });

async function call(context: BuyerContext, name: string, input: unknown): Promise<ToolOutcome> {
  const tool = toolByName(name);
  if (tool === undefined) throw new Error(`No tool ${name}.`);
  const outcome = await tool.run(context, tool.input.parse(input));
  if (outcome.layout !== undefined) context.layout = outcome.layout;
  return outcome;
}

const result = <T>(outcome: ToolOutcome) => outcome.result as T;
const sentences = (outcome: ToolOutcome) => outcome.events.flatMap((event) => (event.sentence === undefined ? [] : [event.sentence]));

describe("make_offer", () => {
  it("agrees on a price and a slot, and the plan pays the agreed price", async () => {
    const port = negotiator(() => accept);
    const context = harborContext({ negotiator: port });
    await call(context, "place_item", { listingId: DESK, xMm: 1800, yMm: 600, rotationDeg: 0, reason: "Desk." });
    const outcome = await call(context, "make_offer", { listingIds: [DESK], priceDollars: 48, slot: MONDAY_2PM });
    expect(result(outcome)).toMatchObject({ sent: true, answer: "accept", status: "agreed", priceDollars: 48, slot: { windowDay: 2, startHour: 14, label: "Mon Nov 23, 2 to 4 PM" } });
    expect(sentences(outcome)).toEqual(["Jun's agent agreed to $48 with handoff Mon Nov 23, 2 to 4 PM."]);
    expect(outcome.events.map((event) => event.agent ?? "buyer")).toEqual(["buyer", "seller"]);
    expect(planTotalCents(context.layout, context.catalog, context.negotiations)).toBe(4_800);
    expect(port.saved.at(-1)).toMatchObject([{ listingId: DESK, status: "agreed", agreedPriceCents: 4_800 }]);
    expect(port.asked[0].facts).toMatchObject({ sellerFirstName: "Jun", items: [{ askingCents: 5_500, floorCents: 4_000 }], round: 1, offer: { priceCents: 4_800, slotLabel: "Mon Nov 23, 2 to 4 PM" } });
  });

  it("takes a counter through respond_to_offer", async () => {
    const context = harborContext({ negotiator: negotiator(() => counter(50)) });
    const offered = await call(context, "make_offer", { listingIds: [DESK], priceDollars: 44, slot: MONDAY_2PM });
    expect(result(offered)).toMatchObject({ answer: "counter", priceDollars: 50, status: "open" });
    expect(sentences(offered)).toEqual(["Jun's agent countered at $50."]);
    const accepted = await call(context, "respond_to_offer", { listingIds: [DESK], action: "accept" });
    expect(result(accepted)).toMatchObject({ done: true, status: "agreed", priceDollars: 50 });
    expect(sentences(accepted)).toEqual(["Took Jun's counter of $50 with handoff Mon Nov 23, 2 to 4 PM."]);
  });

  it("holds the seller's floor in code, whatever the seller agent says", async () => {
    const context = harborContext({ negotiator: negotiator(() => accept) });
    const outcome = await call(context, "make_offer", { listingIds: [DESK], priceDollars: 30, slot: MONDAY_2PM });
    expect(result(outcome)).toMatchObject({ answer: "counter", priceDollars: 40, note: "The offer was under the seller's floor, so code countered at the floor." });
  });

  it("refuses an offer above the asking price or outside the handoff window before any seller agent hears it", async () => {
    const port = negotiator(() => accept);
    const context = harborContext({ negotiator: port });
    expect(result(await call(context, "make_offer", { listingIds: [DESK], priceDollars: 60, slot: MONDAY_2PM }))).toEqual({ sent: false, problems: ["Offer at most the asking price of $55."] });
    expect(result(await call(context, "make_offer", { listingIds: [DESK], priceDollars: 45, slot: { windowDay: 3, startHour: 18 } }))).toEqual({ sent: false, problems: ["That slot falls outside the handoff window."] });
    expect(port.asked).toHaveLength(0);
  });

  it("splits a bundle price over one seller's listings without going under any floor", async () => {
    const context = harborContext({ negotiator: negotiator(() => accept) });
    const outcome = await call(context, "make_offer", { listingIds: [DESK, CHAIR], priceDollars: 65, slot: MONDAY_2PM });
    expect(sentences(outcome)).toEqual(["Jun's agent agreed to $65 for the desk and chair with handoff Mon Nov 23, 2 to 4 PM."]);
    const shares = context.negotiations.get(DESK)?.shares;
    expect(shares?.get(DESK)).toBe(4_800);
    expect(shares?.get(CHAIR)).toBe(1_700);
    expect(result(await call(context, "make_offer", { listingIds: [DESK, LAMP], priceDollars: 60, slot: MONDAY_2PM }))).toMatchObject({ sent: false });
  });

  it("asks different sellers at the same time and one seller's offers in turn", async () => {
    const port = negotiator(() => accept, 40);
    const context = harborContext({ negotiator: port });
    await Promise.all([
      call(context, "make_offer", { listingIds: [DESK], priceDollars: 48, slot: MONDAY_2PM }),
      call(context, "make_offer", { listingIds: [LAMP], priceDollars: 14, slot: MONDAY_2PM }),
      call(context, "make_offer", { listingIds: [CHAIR], priceDollars: 17, slot: MONDAY_2PM }),
    ]);
    const bySeller = (name: string) => port.asked.filter((entry) => entry.facts.sellerFirstName === name);
    const [ava] = bySeller("Ava");
    const [first, second] = bySeller("Jun");
    expect(ava.startedAt).toBeLessThan(first.endedAt);
    expect(second.startedAt).toBeGreaterThanOrEqual(first.endedAt);
  });

  it("ends after three rounds and keeps the asking price", async () => {
    const context = harborContext({ negotiator: negotiator(() => counter(54)) });
    for (const dollars of [41, 43, 45]) await call(context, "make_offer", { listingIds: [DESK], priceDollars: dollars, slot: MONDAY_2PM });
    expect(result(await call(context, "make_offer", { listingIds: [DESK], priceDollars: 46, slot: MONDAY_2PM }))).toEqual({ sent: false, problems: ["All 3 rounds are used, so the asking price stands."] });
    await call(context, "respond_to_offer", { listingIds: [DESK], action: "decline" });
    expect(context.negotiations.get(DESK)?.state.status).toBe("round_limit_reached");
  });

  it("says so when the seller agent gives no valid answer", async () => {
    const context = harborContext({ negotiator: negotiator(() => null) });
    const outcome = await call(context, "make_offer", { listingIds: [DESK], priceDollars: 45, slot: MONDAY_2PM });
    expect(result(outcome)).toMatchObject({ answer: "no_answer", status: "open" });
    expect(sentences(outcome)).toEqual(["Jun's agent did not answer this time, so the asking price stands."]);
  });

  it("cancels the negotiation when the item leaves the plan", async () => {
    const port = negotiator(() => accept);
    const context = harborContext({ negotiator: port });
    const placed = result<{ itemKey: string }>(await call(context, "place_item", { listingId: DESK, xMm: 1800, yMm: 600, rotationDeg: 0, reason: "Desk." }));
    await call(context, "make_offer", { listingIds: [DESK], priceDollars: 48, slot: MONDAY_2PM });
    await call(context, "remove_item", { itemKey: placed.itemKey, reason: "Swap." });
    expect(port.saved.at(-1)).toMatchObject([{ listingId: DESK, status: "canceled", agreedPriceCents: null }]);
  });

  it("names an offer the same way on any day, so a recording replays after the windows move", () => {
    const now = { startsAt: campusInstant("2026-11-22", 9), endsAt: campusInstant("2026-11-24", 18) };
    const later = { startsAt: campusInstant("2026-11-29", 9), endsAt: campusInstant("2026-12-01", 18) };
    const offer = (window: typeof now) => [
      { round: 1, from: "buyer" as const, action: "offer" as const, priceCents: 4_800, handoffSlot: { startsAt: campusInstant(window === now ? "2026-11-23" : "2026-11-30", 14).toISOString(), endsAt: campusInstant(window === now ? "2026-11-23" : "2026-11-30", 16).toISOString() }, message: "Offer.", at: "2026-11-09T00:00:00.000Z" },
    ];
    expect(offerKey(now, [DESK], offer(now))).toBe(offerKey(later, [DESK], offer(later)));
  });
});

describe("same room listings", () => {
  it("stay offered only to the student moving into that room", async () => {
    const elsewhere = harborContext({ roomNumber: "310" });
    const found = result<{ results: { listingId: string }[] }>(await call(elsewhere, "search_listings", { category: "rug" }));
    expect(found.results.map((entry) => entry.listingId)).not.toContain(KILIM);
    const placed = result<{ placed: boolean; problems: string[] }>(await call(elsewhere, "place_item", { listingId: BEAN_BAG, xMm: 1750, yMm: 2150, rotationDeg: 0, reason: "Lounge." }));
    expect(placed.problems).toContain("Navy bean bag chair with matching pouf stays in its room for the student moving in there, so this room cannot take it.");
    const home = result<{ results: { listingId: string; handoff: { days: { windowDay: number }[] } }[] }>(await call(harborContext(), "search_listings", { category: "rug" }));
    expect(home.results.map((entry) => entry.listingId)).toContain(KILIM);
    expect(home.results[0].handoff.days[0].windowDay).toBe(1);
  });
});

describe("search_new_products and place_new_product", () => {
  const throwBlanket: NewProduct = {
    productId: "c3-throw",
    title: "Sherpa fleece throw blanket",
    retailer: "target.com",
    buyUrl: "https://buy.trychannel3.com/c3-throw",
    imageUrl: null,
    priceCents: 2_500,
    sizeMm: { widthMm: 1_520, depthMm: 1_270, heightMm: 20 },
    sizeStated: true,
    category: "bed_accessory",
    placement: "bed",
    furnitureType: "throw",
  };
  const rug: NewProduct = { ...throwBlanket, productId: "c3-rug", buyUrl: "https://buy.trychannel3.com/c3-rug", title: "Round cotton rug 4 ft", priceCents: 2_900, sizeMm: { widthMm: 1_220, depthMm: 1_220, heightMm: 10 }, category: "rug", placement: "underlay", furnitureType: "round_rug" };

  function channel3(products: NewProduct[]): NewProductPort & { queries: unknown[] } {
    const port = {
      queries: [] as unknown[],
      async search(query: unknown) {
        port.queries.push(query);
        return { ok: true as const, products, productCount: 8, credits: 1, cached: false, latencyMs: 900, queryKey: "a".repeat(64) };
      },
    };
    return port;
  }

  it("refuses while a used listing in the category could still fit", async () => {
    const port = channel3([rug]);
    const context = harborContext({ channel3: port });
    const outcome = await call(context, "search_new_products", { category: "rug", query: "small round rug" });
    expect(result<{ searched: boolean; problems: string[] }>(outcome).problems[0]).toMatch(/^Used listings in rug still fit: /);
    expect(port.queries).toHaveLength(0);
  });

  it("searches Channel3 under the budget left once no used listing fits, and places the product outside the PayPal order", async () => {
    const port = channel3([rug]);
    const context = harborContext({ channel3: port, budgetCents: 4_000 });
    for (const id of [listingId("jun-round-jute-rug"), KILIM, listingId("ava-floral-area-rug")]) context.fitFailures.add(id);
    const searched = await call(context, "search_new_products", { category: "rug", query: "small round rug", maxPriceDollars: 60, maxWidthMm: 1_300, maxDepthMm: 1_300 });
    expect(port.queries[0]).toMatchObject({ text: "small round rug", category: "rug", maxPriceCents: 4_000, maxWidthMm: 1_300 });
    expect(result(searched)).toMatchObject({ searched: true, credits: 1, products: [{ productId: "c3-rug", retailer: "target.com", priceCents: 2_900 }] });
    expect(sentences(searched)).toEqual(["Checking new rugs on Channel3."]);
    expect(searched.events[0].detail?.channel3).toMatchObject({ query: "small round rug", credits: 1, cached: false, productCount: 8 });

    const placed = await call(context, "place_new_product", { productId: "c3-rug", xMm: 1_800, yMm: 2_200, rotationDeg: 0, reason: "Soft floor." });
    expect(result(placed)).toMatchObject({ placed: true, notInPayPalOrder: true, budgetLeftCents: 1_100 });
    expect(sentences(placed)).toEqual(["No used rug fits, so here is a new one from target.com for $29."]);
    expect(context.layout.items[0]).toMatchObject({ source: "new_product", retailer: "target.com", buyUrl: "https://buy.trychannel3.com/c3-rug", category: "rug" });
  });

  it("checks the budget and the fit for a new product like any item", async () => {
    const context = harborContext({ channel3: channel3([throwBlanket]), budgetCents: 2_000 });
    context.newProducts.set(throwBlanket.productId, throwBlanket);
    const outcome = await call(context, "place_new_product", { productId: "c3-throw", xMm: 1_800, yMm: 2_200, rotationDeg: 0, reason: "Warm." });
    expect(result<{ placed: boolean; problems: string[] }>(outcome).problems).toContain("It costs $25 and $20 of the $20 budget is left.");
  });
});
