import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { recordingTransport, replayTransport } from "@/lib/agents/buyer/claude";
import type { EventDraft } from "@/lib/agents/buyer/context";
import { BUYER_MODEL, BUYER_TOOL_DEFINITIONS, MAX_TURNS, runBuyerLoop, type BuyerRequest, type ClaudeTransport, type LoopHooks } from "@/lib/agents/buyer/loop";
import type { PlanLayout } from "@/lib/domain/layout";
import { harborContext, listingId } from "./support/buyer-context";

type Message = Anthropic.Beta.Messages.BetaMessage;

let ids = 0;
function message(content: unknown[], stop: Message["stop_reason"] = "tool_use"): Message {
  ids += 1;
  return {
    id: `msg_${ids}`,
    type: "message",
    role: "assistant",
    model: BUYER_MODEL,
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 },
  } as unknown as Message;
}

const call = (name: string, input: unknown) => ({ type: "tool_use", id: `toolu_${(ids += 1)}`, name, input });
const text = (value: string) => ({ type: "text", text: value });
const FINAL = text('{"summary": "A desk under the window."}');
const PLACE_DESK = call("place_item", { listingId: listingId("jun-white-desk"), xMm: 1800, yMm: 600, rotationDeg: 0, reason: "Desk under the window." });

/** Replies in order and keeps every request it was sent. */
function scripted(replies: Message[]): ClaudeTransport & { requests: BuyerRequest[] } {
  const requests: BuyerRequest[] = [];
  return {
    requests,
    async send(request) {
      requests.push(structuredClone(request));
      const reply = replies.shift();
      if (reply === undefined) throw new Error("No scripted reply left.");
      return reply;
    },
  };
}

function hooks() {
  const events: EventDraft[] = [];
  const layouts: PlanLayout[] = [];
  let calls = 0;
  const value: LoopHooks = {
    async beforeCall() {},
    async afterCall() {
      calls += 1;
    },
    async onEvents(drafts) {
      events.push(...drafts);
    },
    async onLayout(layout) {
      layouts.push(layout);
    },
  };
  return { value, events, layouts, calls: () => calls };
}

describe("runBuyerLoop", () => {
  it("runs tools, writes the layout, and ends on the summary JSON", async () => {
    const transport = scripted([message([call("get_room_preset", {}), call("get_hall_rules", {})]), message([PLACE_DESK]), message([FINAL], "end_turn")]);
    const recorder = hooks();
    const context = harborContext();
    const outcome = await runBuyerLoop({ transport, context, kind: "plan", hooks: recorder.value });
    expect(outcome).toEqual({ status: "succeeded", summary: "A desk under the window." });
    expect(recorder.calls()).toBe(3);
    expect(recorder.layouts).toHaveLength(1);
    expect(context.layout.items).toHaveLength(1);
    expect(recorder.events.map((event) => event.tool)).toEqual(["get_room_preset", "get_hall_rules", "place_item"]);
    // Both results of the first turn go back in one user message.
    const second = transport.requests[1].messages;
    expect(second.at(-1)).toMatchObject({ role: "user", content: [{ type: "tool_result" }, { type: "tool_result" }] });
  });

  it("sends the model, effort, fallback, tools, and three cache breakpoints", async () => {
    const transport = scripted([message([FINAL], "end_turn")]);
    await runBuyerLoop({ transport, context: harborContext(), kind: "plan", hooks: hooks().value });
    const [request] = transport.requests;
    expect(request.model).toBe("claude-sonnet-5-5");
    expect(request.output_config).toEqual({ effort: "medium" });
    expect(request.fallbacks).toBe("default");
    expect(request.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(request.cache_control).toEqual({ type: "ephemeral" });
    expect(request.system).toEqual([
      expect.objectContaining({ cache_control: { type: "ephemeral" } }),
      expect.objectContaining({ text: expect.stringContaining("Harbor Hall room standards"), cache_control: { type: "ephemeral" } }),
    ]);
    expect(request.tools?.map((tool) => ("name" in tool ? tool.name : ""))).toEqual(BUYER_TOOL_DEFINITIONS.map((tool) => tool.name));
    expect(BUYER_TOOL_DEFINITIONS.every((tool) => !("$schema" in tool.input_schema) && tool.input_schema.type === "object")).toBe(true);
    expect(request.messages[0]).toEqual({ role: "user", content: expect.stringContaining('Jordan wrote: "$150, cozy, I study late"') });
  });

  it("returns a validation error once for invalid tool input and continues when the retry is valid", async () => {
    const bad = call("place_item", { listingId: "not-a-uuid", xMm: 1800, yMm: 600, rotationDeg: 45, reason: "x" });
    const transport = scripted([message([bad]), message([PLACE_DESK]), message([FINAL], "end_turn")]);
    const outcome = await runBuyerLoop({ transport, context: harborContext(), kind: "plan", hooks: hooks().value });
    expect(outcome.status).toBe("succeeded");
    const retry = transport.requests[1].messages.at(-1);
    expect(retry).toMatchObject({ role: "user", content: [{ type: "tool_result", is_error: true, content: expect.stringContaining("Invalid input for place_item") }] });
  });

  it("fails visibly when tool input is invalid twice in a row", async () => {
    const bad = () => call("search_listings", { limit: 500 });
    const transport = scripted([message([bad()]), message([bad()])]);
    expect(await runBuyerLoop({ transport, context: harborContext(), kind: "plan", hooks: hooks().value })).toEqual({
      status: "failed",
      error: "The buyer agent sent invalid tool input twice in a row.",
    });
  });

  it("treats an unknown tool name as invalid output", async () => {
    const transport = scripted([message([call("make_offer", { price: 1 })]), message([call("search_new_products", {})])]);
    const outcome = await runBuyerLoop({ transport, context: harborContext(), kind: "plan", hooks: hooks().value });
    expect(outcome.status).toBe("failed");
    expect(transport.requests[1].messages.at(-1)).toMatchObject({ content: [{ is_error: true, content: "There is no tool named make_offer." }] });
  });

  it("asks once more when the final reply is not the summary JSON", async () => {
    const transport = scripted([message([text("All done!")], "end_turn"), message([FINAL], "end_turn")]);
    expect((await runBuyerLoop({ transport, context: harborContext(), kind: "plan", hooks: hooks().value })).status).toBe("succeeded");
    expect(transport.requests[1].messages.at(-1)).toEqual({ role: "user", content: 'Your last reply was not JSON. Reply with only {"summary": "..."}.' });
  });

  it("accepts the summary JSON with prose around it, and fails after two replies that miss the schema", async () => {
    const wrapped = scripted([message([text('Here you go: {"summary": "Done."} Thanks.')], "end_turn")]);
    expect(await runBuyerLoop({ transport: wrapped, context: harborContext(), kind: "plan", hooks: hooks().value })).toEqual({ status: "succeeded", summary: "Done." });
    const wrong = scripted([message([text('{"note": "x"}')], "end_turn"), message([text('{"summary": ""}')], "end_turn")]);
    expect((await runBuyerLoop({ transport: wrong, context: harborContext(), kind: "plan", hooks: hooks().value })).status).toBe("failed");
  });

  it("stops on a refusal and on the step limit", async () => {
    const refused = scripted([message([], "refusal")]);
    expect(await runBuyerLoop({ transport: refused, context: harborContext(), kind: "plan", hooks: hooks().value })).toEqual({ status: "failed", error: "The model declined to continue this plan." });
    const endless = scripted(Array.from({ length: MAX_TURNS.edit }, () => message([call("get_hall_rules", {})])));
    expect(await runBuyerLoop({ transport: endless, context: harborContext(), kind: "edit", request: "Move it", hooks: hooks().value })).toEqual({
      status: "failed",
      error: `The buyer agent did not finish within ${MAX_TURNS.edit} steps.`,
    });
  });

  it("opens an edit run with the student's request and the current plan", async () => {
    const context = harborContext();
    await runBuyerLoop({ transport: scripted([message([PLACE_DESK]), message([FINAL], "end_turn")]), context, kind: "plan", hooks: hooks().value });
    const transport = scripted([message([FINAL], "end_turn")]);
    await runBuyerLoop({ transport, context, kind: "edit", request: "Move the desk to the east wall", hooks: hooks().value });
    const opening = transport.requests[0].messages[0].content as string;
    expect(opening).toContain('Jordan asked for a change: "Move the desk to the east wall"');
    expect(opening).toContain("white-three-drawer-desk-with-oak-legs: White three drawer desk with oak legs, under the window, at 1800, 600 mm");
  });

  it("lets a hook stop the run before a call", async () => {
    const transport = scripted([message([FINAL], "end_turn")]);
    const stopping = { ...hooks().value, beforeCall: async () => Promise.reject(new Error("Daily allowance used.")) };
    await expect(runBuyerLoop({ transport, context: harborContext(), kind: "plan", hooks: stopping })).rejects.toThrow("Daily allowance used.");
    expect(transport.requests).toHaveLength(0);
  });
});

describe("Claude transports", () => {
  it("replays a recording in order and fails past its end", async () => {
    const folder = await mkdtemp(join(tmpdir(), "roomover-replay-"));
    const path = join(folder, "recording.json");
    await writeFile(path, JSON.stringify({ version: 1, runs: { plan: [message([FINAL], "end_turn")], edit: [] } }));
    const transport = await replayTransport(path, "plan");
    expect((await transport.send({} as BuyerRequest)).content).toEqual([FINAL]);
    await expect(transport.send({} as BuyerRequest)).rejects.toThrow("The recorded plan conversation has no reply 2.");
  });

  it("records each reply under its run kind and keeps the other kind", async () => {
    const folder = await mkdtemp(join(tmpdir(), "roomover-record-"));
    const path = join(folder, "recording.json");
    await writeFile(path, JSON.stringify({ version: 1, runs: { plan: [message([FINAL], "end_turn")], edit: [] } }));
    const transport = recordingTransport(scripted([message([PLACE_DESK]), message([FINAL], "end_turn")]), path, "edit");
    await transport.send({} as BuyerRequest);
    await transport.send({} as BuyerRequest);
    const saved = JSON.parse(await readFile(path, "utf8")) as { runs: { plan: unknown[]; edit: unknown[] } };
    expect(saved.runs.plan).toHaveLength(1);
    expect(saved.runs.edit).toHaveLength(2);
  });

  it("ships a fixture with a full plan run and a full edit run", async () => {
    const fixture = JSON.parse(await readFile("tests/fixtures/buyer-agent.json", "utf8")) as { runs: Record<"plan" | "edit", Message[]> };
    for (const kind of ["plan", "edit"] as const) {
      const replies = fixture.runs[kind];
      expect(replies.length).toBeGreaterThan(1);
      expect(replies.at(-1)?.stop_reason).toBe("end_turn");
      expect(replies.every((reply) => reply.model.startsWith("claude-sonnet-5-5"))).toBe(true);
    }
  });
});
