import { readFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { readReplyRecording } from "@/lib/agents/recording";
import { buildSellerRequest, DESCRIBE_LISTING_TOOL, describeListing, SELLER_FAILED, SELLER_REFUSED, type SellerRequest, type SellerTransport } from "@/lib/agents/seller/describe";
import { sellerMessage } from "@/lib/agents/seller/prompt";
import { sha256 } from "@/lib/agents/verifier/facts";
import { sellerVerdictSchema, type Channel3Candidate } from "@/lib/domain/sell";
import { SELL_SAMPLES } from "@/lib/sell/samples";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

const photo = { mediaType: "image/jpeg" as const, base64: "AAAA" };
const cart: Channel3Candidate = { productId: "OZSFCDr", title: "Råskog Utility Cart", brand: "Ikea", imageUrl: "https://cdn.trychannel3.com/cart", newPriceCents: 3_900, url: "https://buy.trychannel3.com/x", domain: "ikea.com", sizeMm: { widthMm: 450, depthMm: 350, heightMm: 780 } };
const verdict = {
  category: "storage",
  title: "Black 3-tier rolling utility cart",
  description: "A black metal rolling cart with three trays.",
  condition: "like_new",
  defects: [],
  colorName: "Black",
  colorHex: "#25262A",
  material: "Metal",
  styleTags: ["minimal"],
  matchedCandidate: 1,
  newPriceDollars: 39,
  priceDollars: 21,
  floorDollars: 16,
};

function reply(content: unknown[], stop: BetaMessage["stop_reason"] = "tool_use"): BetaMessage {
  return { id: "msg", type: "message", role: "assistant", model: "claude-sonnet-5-5", content, stop_reason: stop, usage: { input_tokens: 9_000, output_tokens: 400 } } as unknown as BetaMessage;
}
const call = (input: unknown, id = "toolu_1") => ({ type: "tool_use", id, name: "describe_listing", input });

function scripted(replies: BetaMessage[]): SellerTransport & { requests: SellerRequest[] } {
  const requests: SellerRequest[] = [];
  return {
    requests,
    async send(request) {
      requests.push(structuredClone(request));
      const next = replies.shift();
      if (next === undefined) throw new Error("No reply left.");
      return next;
    },
  };
}

describe("the describe_listing tool", () => {
  it("is strict, keeps no keyword strict tools refuse, and the request lets Claude choose it with fallbacks on", () => {
    expect(DESCRIBE_LISTING_TOOL.strict).toBe(true);
    const text = JSON.stringify(DESCRIBE_LISTING_TOOL.input_schema);
    for (const keyword of ["minLength", "maxLength", "minimum", "maximum", "maxItems", "pattern"]) expect(text).not.toContain(`"${keyword}"`);
    const request = buildSellerRequest([]);
    expect([request.model, request.tool_choice, request.fallbacks, request.betas, request.output_config]).toEqual(["claude-sonnet-5-5", { type: "auto" }, "default", ["server-side-fallback-2026-07-01"], { effort: "medium" }]);
  });

  it("sends the photo first, then each candidate in words with its product photo", () => {
    const content = sellerMessage(photo, [{ candidate: cart, photo }, { candidate: { ...cart, productId: "B", title: "Other cart", brand: null, sizeMm: null }, photo: null }]);
    expect(content.map((block) => block.type)).toEqual(["text", "image", "text", "image", "text", "text"]);
    expect(content[2]).toEqual({ type: "text", text: "Candidate 1: Råskog Utility Cart by Ikea, new $39 at ikea.com, size 45 by 35 by 78 cm (width, depth, height)." });
    expect(content[4]).toEqual({ type: "text", text: "Candidate 2: Other cart, new $39 at ikea.com, size not stated." });
  });
});

describe("describeListing", () => {
  it("returns a valid verdict from the first reply", async () => {
    const transport = scripted([reply([call(verdict)])]);
    const result = await describeListing(transport, photo, [{ candidate: cart, photo }]);
    expect(result.ok && [result.verdict.matchedCandidate, result.attempts, result.usage.calls]).toEqual([1, 1, 1]);
  });

  it("retries once with the validation error, including a candidate number that does not exist", async () => {
    const transport = scripted([reply([call({ ...verdict, matchedCandidate: 3 })]), reply([call(verdict, "toolu_2")])]);
    const result = await describeListing(transport, photo, [{ candidate: cart, photo }]);
    expect(result.ok && result.attempts).toBe(2);
    const retry = transport.requests[1].messages.at(-1);
    expect(JSON.stringify(retry)).toContain("matchedCandidate must be a candidate number from 1 to 1, or null.");
    expect(JSON.stringify(retry)).toContain('"is_error":true');
  });

  it("ends with a visible failure after a second invalid answer, and with a refusal sentence on a refusal", async () => {
    const twice = await describeListing(scripted([reply([call({ ...verdict, priceDollars: -1 })]), reply([{ type: "text", text: "Here you go" }])]), photo, []);
    expect(twice).toEqual({ ok: false, error: SELLER_FAILED, usage: { calls: 2, inputTokens: 18_000, outputTokens: 800 } });
    const refused = await describeListing(scripted([reply([], "refusal")]), photo, []);
    expect(refused.ok === false && refused.error).toBe(SELLER_REFUSED);
  });
});

describe("the recorded seller agent fixture", () => {
  it("holds a valid verdict for every Sell sample, so the e2e run replays each one", async () => {
    const recording = await readReplyRecording("tests/fixtures/seller-agent.json");
    for (const sample of SELL_SAMPLES) {
      const replies = recording.photos[sha256(readFileSync(`public${sample.src}`))];
      expect(replies, sample.slug).toBeDefined();
      const input = (replies?.at(-1)?.content as { type: string; name?: string; input?: unknown }[]).find((block) => block.type === "tool_use" && block.name === "describe_listing")?.input;
      expect(sellerVerdictSchema.safeParse(input).success, sample.slug).toBe(true);
    }
  });
});
