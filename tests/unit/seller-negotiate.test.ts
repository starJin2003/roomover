import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { answerOffer, buildNegotiatorRequest, NEGOTIATOR_FAILED, type NegotiatorRequest, type NegotiatorTransport } from "@/lib/agents/seller/negotiate";
import { NEGOTIATOR_INSTRUCTIONS, negotiationMessage, type OfferFacts } from "@/lib/agents/seller/negotiate-prompt";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

const FACTS: OfferFacts = {
  sellerFirstName: "Jun",
  items: [{ title: "White three drawer desk with oak legs", askingCents: 5_500, floorCents: 4_000 }],
  round: 1,
  roundLimit: 3,
  history: [],
  offer: { priceCents: 4_500, slotLabel: "Mon, Nov 23, 2 to 4 PM" },
  slots: [
    { number: 1, label: "Mon, Nov 23, noon to 2 PM" },
    { number: 2, label: "Mon, Nov 23, 4 to 6 PM" },
  ],
};

function reply(input: unknown, stop: BetaMessage["stop_reason"] = "tool_use"): BetaMessage {
  return {
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: input === null ? [] : [{ type: "tool_use", id: "toolu_1", name: "answer_offer", input }],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 610, cache_creation_input_tokens: 0 },
  } as unknown as BetaMessage;
}

function scripted(replies: BetaMessage[]): NegotiatorTransport & { requests: NegotiatorRequest[] } {
  const requests: NegotiatorRequest[] = [];
  return {
    mode: "live",
    requests,
    async send(request) {
      requests.push(structuredClone(request));
      const next = replies.shift();
      if (next === undefined) throw new Error("No reply left.");
      return next;
    },
  };
}

describe("the negotiating seller agent", () => {
  it("runs on Sonnet 5.5 at low effort with a strict tool and cached instructions", () => {
    const request = buildNegotiatorRequest([{ role: "user", content: "x" }]);
    expect(request).toMatchObject({ model: "claude-sonnet-5-5", output_config: { effort: "low" }, fallbacks: "default", tool_choice: { type: "auto" } });
    expect(request.tools?.[0]).toMatchObject({ name: "answer_offer", strict: true });
    expect(request.system).toEqual([{ type: "text", text: NEGOTIATOR_INSTRUCTIONS, cache_control: { type: "ephemeral" } }]);
  });

  it("reads the seller's facts, the round, and the slots it may propose", () => {
    const message = negotiationMessage({ ...FACTS, round: 3, history: ["Round 1: The student's agent offered $40 for Mon, Nov 23, 2 to 4 PM."] });
    expect(message).toContain("- White three drawer desk with oak legs: asking $55, floor $40");
    expect(message).toContain("Round 3 of 3. Your counter is final.");
    expect(message).toContain("This offer: $45 with handoff Mon, Nov 23, 2 to 4 PM.");
    expect(message).toContain("2. Mon, Nov 23, 4 to 6 PM");
  });

  it("answers with the counter and counts its tokens", async () => {
    const transport = scripted([reply({ action: "counter", counterDollars: 50, slotNumber: 2, message: "Could you do $50 at 4?" })]);
    const result = await answerOffer(transport, FACTS);
    expect(result).toMatchObject({ ok: true, attempts: 1, answer: { action: "counter", counterDollars: 50, slotNumber: 2 }, usage: { calls: 1, inputTokens: 120, cacheReadTokens: 610 } });
  });

  it("retries once with the validation error, then answers", async () => {
    const transport = scripted([reply({ action: "counter", counterDollars: null, slotNumber: 9, message: "Hmm." }), reply({ action: "accept", counterDollars: null, slotNumber: null, message: "Deal at $45." })]);
    const result = await answerOffer(transport, FACTS);
    expect(result).toMatchObject({ ok: true, attempts: 2, answer: { action: "accept" } });
    const retry = transport.requests[1].messages.at(-1);
    expect(retry).toMatchObject({ role: "user", content: [{ type: "tool_result", is_error: true, content: "The answer did not validate. A counter needs counterDollars. Call answer_offer again." }] });
  });

  it("gives up after a second invalid answer or a refusal, so the asking price stands", async () => {
    expect(await answerOffer(scripted([reply(null, "end_turn"), reply(null, "end_turn")]), FACTS)).toMatchObject({ ok: false, error: NEGOTIATOR_FAILED, usage: { calls: 2 } });
    expect(await answerOffer(scripted([reply(null, "refusal")]), FACTS)).toMatchObject({ ok: false, usage: { calls: 1 } });
  });

  it("refuses a slot number that is not on the list", async () => {
    const transport = scripted([reply({ action: "counter", counterDollars: 50, slotNumber: 7, message: "x" }), reply({ action: "counter", counterDollars: 50, slotNumber: 1, message: "x" })]);
    expect(await answerOffer(transport, FACTS)).toMatchObject({ ok: true, attempts: 2, answer: { slotNumber: 1 } });
  });
});
