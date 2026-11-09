import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { buildVerifierRequest, COMPARE_PHOTOS_TOOL, comparePhotos, strictSchema, VERIFIER_FAILED, VERIFIER_REFUSED, type VerifierRequest, type VerifierTransport } from "@/lib/agents/verifier/compare";
import { comparisonMessage } from "@/lib/agents/verifier/prompt";
import { readVerifierRecording } from "@/lib/agents/verifier/transport";
import { damageWords, verdictSchema } from "@/lib/domain/verdict";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

const listing = { title: "Mesh back rolling desk chair", description: "Black mesh back, gray padded seat.", sizeMm: [630, 600, 950] as const, listedWear: ["seat: Light creases in the vinyl seat cover"] };
const photo = { mediaType: "image/jpeg" as const, base64: "AAAA" };
const torn = { verdict: "new_damage", damage: { kind: "tear", location: "seat cover", sizeCm: 3, severity: "minor" }, confidence: "high", observations: "A small split in the seat vinyl." };

function reply(content: unknown[], stop: BetaMessage["stop_reason"] = "tool_use"): BetaMessage {
  return { id: "msg", type: "message", role: "assistant", model: "claude-sonnet-5-5", content, stop_reason: stop, usage: { input_tokens: 4_000, output_tokens: 250 } } as unknown as BetaMessage;
}
const call = (input: unknown, id = "toolu_1") => ({ type: "tool_use", id, name: "compare_photos", input });

function scripted(replies: BetaMessage[]): VerifierTransport & { requests: VerifierRequest[] } {
  const requests: VerifierRequest[] = [];
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

describe("the compare_photos tool", () => {
  it("is strict, and its schema keeps no keyword strict tools refuse", () => {
    expect(COMPARE_PHOTOS_TOOL.strict).toBe(true);
    const text = JSON.stringify(COMPARE_PHOTOS_TOOL.input_schema);
    for (const keyword of ["minLength", "maxLength", "minimum", "maximum", "$schema"]) expect(text).not.toContain(`"${keyword}"`);
    expect(text).toContain('"additionalProperties":false');
    expect(strictSchema({ a: { minimum: 1, type: "number" }, b: [{ maxLength: 3 }] })).toEqual({ a: { type: "number" }, b: [{}] });
  });

  it("asks Sonnet 5.5 with tool choice auto, medium effort, and the default fallback", () => {
    const request = buildVerifierRequest([]);
    expect(request.model).toBe("claude-sonnet-5-5");
    expect(request.tool_choice).toEqual({ type: "auto" });
    expect(request.output_config).toEqual({ effort: "medium" });
    expect(request.fallbacks).toBe("default");
    expect(request.betas).toEqual(["server-side-fallback-2026-07-01"]);
  });

  it("labels the listing photos and the handoff photo, and names the listed wear", () => {
    const blocks = comparisonMessage(listing, [photo, photo], photo);
    const texts = blocks.flatMap((block) => (block.type === "text" ? [block.text] : []));
    expect(texts[0]).toContain("Size 63 by 60 by 95 cm");
    expect(texts[0]).toContain("Wear the seller listed: seat: Light creases in the vinyl seat cover.");
    expect(texts).toContain("Listing photo 2, taken by the seller:");
    expect(texts).toContain("Handoff photo, taken by the buyer at pickup:");
    expect(blocks.filter((block) => block.type === "image")).toHaveLength(3);
  });
});

describe("comparePhotos", () => {
  it("returns a valid verdict from the first call", async () => {
    const transport = scripted([reply([call(torn)])]);
    const result = await comparePhotos(transport, listing, [photo], photo);
    expect(result).toMatchObject({ ok: true, attempts: 1, verdict: torn, usage: { calls: 1, inputTokens: 4_000, outputTokens: 250 } });
  });

  it("retries once with the validation error as a tool result, and takes the corrected verdict", async () => {
    const transport = scripted([reply([call({ ...torn, damage: null })]), reply([call(torn, "toolu_2")])]);
    const result = await comparePhotos(transport, listing, [photo], photo);
    expect(result).toMatchObject({ ok: true, attempts: 2 });
    const retry = transport.requests[1].messages;
    expect(retry).toHaveLength(3);
    const feedback = (retry[2].content as { type: string; is_error?: boolean; content?: string }[])[0];
    expect(feedback).toMatchObject({ type: "tool_result", is_error: true });
    expect(feedback.content).toContain("A new_damage verdict needs the damage object.");
  });

  it("asks again when the model answers without calling the tool", async () => {
    const transport = scripted([reply([{ type: "text", text: "It looks fine." }], "end_turn"), reply([call({ ...torn, verdict: "match", damage: null })])]);
    const result = await comparePhotos(transport, listing, [photo], photo);
    expect(result).toMatchObject({ ok: true, attempts: 2, verdict: { verdict: "match" } });
    expect(transport.requests[1].messages[2].content).toEqual([{ type: "text", text: "You did not call compare_photos. Call it now with your verdict." }]);
  });

  it("fails visibly after a second invalid verdict", async () => {
    const transport = scripted([reply([call({ verdict: "maybe" })]), reply([call({ verdict: "maybe" }, "toolu_2")])]);
    expect(await comparePhotos(transport, listing, [photo], photo)).toEqual({ ok: false, error: VERIFIER_FAILED, usage: { calls: 2, inputTokens: 8_000, outputTokens: 500 } });
  });

  it("fails visibly on a refusal without retrying", async () => {
    const transport = scripted([reply([], "refusal")]);
    expect(await comparePhotos(transport, listing, [photo], photo)).toMatchObject({ ok: false, error: VERIFIER_REFUSED, usage: { calls: 1 } });
  });
});

describe("the verdict", () => {
  it("carries damage only for new damage", () => {
    expect(verdictSchema.safeParse(torn).success).toBe(true);
    expect(verdictSchema.safeParse({ ...torn, damage: null }).success).toBe(false);
    expect(verdictSchema.safeParse({ ...torn, verdict: "match" }).success).toBe(false);
    expect(verdictSchema.safeParse({ ...torn, verdict: "missing", damage: null }).success).toBe(true);
  });

  it("says the damage in a few words", () => {
    expect(damageWords({ kind: "tear", location: "seat", sizeCm: 3.4, severity: "minor" })).toBe("3 cm tear");
    expect(damageWords({ kind: "scratch", location: "top", sizeCm: 1.25, severity: "minor" })).toBe("1.3 cm scratch");
    expect(damageWords({ kind: "dent", location: "leg", sizeCm: null, severity: "minor" })).toBe("dent");
  });
});

describe("the recorded comparisons", () => {
  it("hold a valid verdict for every sample photo, with new damage only on the torn chair", async () => {
    const recording = await readVerifierRecording("tests/fixtures/verifier-agent.json");
    const verdicts = Object.values(recording.photos).map((replies) => {
      const last = replies.at(-1) as unknown as BetaMessage;
      const used = last.content.find((block) => block.type === "tool_use");
      return verdictSchema.parse(used?.type === "tool_use" ? used.input : null);
    });
    expect(verdicts).toHaveLength(25);
    expect(verdicts.filter((verdict) => verdict.verdict === "match")).toHaveLength(24);
    expect(verdicts.find((verdict) => verdict.verdict === "new_damage")?.damage).toMatchObject({ kind: "tear", sizeCm: 3, severity: "minor" });
  });
});
