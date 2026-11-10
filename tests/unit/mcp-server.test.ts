import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpDeps } from "@/mcp/deps";
import { buildMcpServer, MCP_INSTRUCTIONS } from "@/mcp/server";
import { closeIdleSessions, handleMcpRequest, openSessions } from "@/mcp/sessions";
import { CAMPUS, UNIVERSITY } from "@/scripts/seed/campus";
import { seedCatalog } from "./support/buyer-context";

type Call = Parameters<McpDeps["recordCall"]>;

function fakeDeps(calls: Call[] = []): McpDeps {
  return {
    searchScope: async () => ({ campusSlug: CAMPUS, campusName: UNIVERSITY, room: null, roomLabel: null, appUrl: "https://roomover.example" }),
    catalog: async () => ({ catalog: seedCatalog(), extras: new Map() }),
    presets: async () => [],
    demoRoom: () => ({ presetSlug: "harbor-hall-double", label: "Harbor Hall 214", student: "Jordan Ellis," }),
    // plan_room has its own tests with a fake buyer agent.
    planRoom: () => ({}) as ReturnType<McpDeps["planRoom"]>,
    createCheckout: () => ({
      appUrl: "https://roomover.example",
      ownPlan: async () => null,
      prepare: async () => ({ ok: false, message: "unused" }),
    }),
    recordCall: async (...args) => {
      calls.push(args);
    },
  };
}

async function connected(deps: McpDeps, fromAnthropic = false): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = buildMcpServer(deps, { buyerSession: "mcp-abcdefghijklmnopqrst", clientHash: "hash", fromAnthropic, logRunId: "11111111-1111-4111-8111-111111111111" });
  await server.connect(serverSide);
  const client = new Client({ name: "claude-code", version: "2.1.0" });
  await client.connect(clientSide);
  return client;
}

describe("the Roomover MCP server", () => {
  it("lists four tools with descriptions, input schemas, and output schemas, and says money moves only after approval", async () => {
    const client = await connected(fakeDeps());
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["search_listings", "get_room_presets", "plan_room", "create_checkout"]);
    expect(tools.every((tool) => tool.outputSchema?.type === "object")).toBe(true);
    expect(tools.find((tool) => tool.name === "plan_room")?.inputSchema.required).toEqual(["roomPresetSlug", "request"]);
    expect(tools.find((tool) => tool.name === "create_checkout")?.description).toMatch(/never approves or charges anything/);
    expect(client.getInstructions()).toBe(MCP_INSTRUCTIONS);
    expect(MCP_INSTRUCTIONS).toMatch(/Money moves only after the student approves in PayPal/);
  });

  it("records each call with the tool, the client's name, and its latency", async () => {
    const calls: Call[] = [];
    const client = await connected(fakeDeps(calls));
    const result = await client.callTool({ name: "search_listings", arguments: { category: "desk" } });
    expect(result.isError ?? false).toBe(false);
    expect(calls).toHaveLength(1);
    const [runId, record, meta] = calls[0];
    expect(runId).toBe("11111111-1111-4111-8111-111111111111");
    expect(record.planId).toBeNull();
    expect(record.summary).toMatch(/^search_listings for desk found \d+\.$/);
    expect(meta).toMatchObject({ tool: "search_listings", client: { name: "claude-code", version: "2.1.0", fromAnthropic: false }, blocked: false });
    expect(meta.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("marks a session that arrived from Anthropic's servers, as the Claude app's connector does", async () => {
    const calls: Call[] = [];
    const client = await connected(fakeDeps(calls), true);
    await client.callTool({ name: "get_room_presets", arguments: {} });
    expect(calls[0][2].client).toEqual({ name: "claude-code", version: "2.1.0", fromAnthropic: true });
  });

  it("answers a refusal as a tool error and records it as blocked", async () => {
    const calls: Call[] = [];
    const client = await connected(fakeDeps(calls));
    const result = await client.callTool({ name: "create_checkout", arguments: { planId: "5b1d1b8e-3f5a-4c1e-9d2a-6f1b2c3d4e5f" } });
    expect(result.isError).toBe(true);
    expect(calls[0][2]).toMatchObject({ tool: "create_checkout", blocked: true });
  });

  it("refuses arguments outside the input schema before any handler runs", async () => {
    const calls: Call[] = [];
    const client = await connected(fakeDeps(calls));
    const result = await client.callTool({ name: "create_checkout", arguments: { planId: "not-a-plan" } });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("hides an unexpected failure behind one sentence", async () => {
    const deps = fakeDeps();
    deps.catalog = async () => Promise.reject(new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = await connected(deps);
    const result = await client.callTool({ name: "search_listings", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).not.toMatch(/connection refused/);
  });
});

const ACCEPT = "application/json, text/event-stream";

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3100/mcp", { method: "POST", headers: new Headers({ "content-type": "application/json", accept: ACCEPT, host: "localhost:3100", ...headers }), body: JSON.stringify(body) });
}

const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1.0" } } };

/** The JSON-RPC message in a response, whether it came as JSON or as one server sent event. */
async function message(response: Response): Promise<Record<string, unknown>> {
  const body = await response.text();
  const data = body.startsWith("{") ? body : (body.split("\n").find((line) => line.startsWith("data: "))?.slice(6) ?? "{}");
  return JSON.parse(data) as Record<string, unknown>;
}

describe("MCP sessions over streamable HTTP", () => {
  const setup = (clientHash = "net-a") => ({ deps: fakeDeps(), buyerSessionFor: (id: string) => `mcp-${id.replace(/-/g, "").slice(0, 20)}`, clientHash, fromAnthropic: false, allowedHosts: ["localhost:3100"] });

  afterEach(async () => {
    for (const session of openSessions().values()) await session.transport.close();
    openSessions().clear();
  });

  it("opens a session on initialize and routes later requests by Mcp-Session-Id", async () => {
    const opened = await handleMcpRequest(post(initialize), setup());
    expect(opened.status).toBe(200);
    const id = opened.headers.get("mcp-session-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await message(opened)).result).toMatchObject({ serverInfo: { name: "roomover" } });
    await handleMcpRequest(post({ jsonrpc: "2.0", method: "notifications/initialized" }, { "mcp-session-id": id ?? "", "mcp-protocol-version": "2025-11-25" }), setup());
    const listed = await handleMcpRequest(post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-session-id": id ?? "", "mcp-protocol-version": "2025-11-25" }), setup());
    expect(((await message(listed)).result as { tools: unknown[] }).tools).toHaveLength(4);
  });

  it("answers 404 for an unknown session and 400 for a request with none", async () => {
    expect((await handleMcpRequest(post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-session-id": "gone" }), setup())).status).toBe(404);
    expect((await handleMcpRequest(post({ jsonrpc: "2.0", id: 2, method: "tools/list" }), setup())).status).toBe(400);
  });

  it("refuses a host it does not serve, which stops DNS rebinding", async () => {
    const response = await handleMcpRequest(post(initialize, { host: "evil.example" }), setup());
    expect(response.status).toBe(403);
  });

  it("lets one network open more than the old 30 sessions, makes room in a full table by closing the session idle longest, and closes idle ones", async () => {
    for (let index = 0; index < 31; index += 1) expect((await handleMcpRequest(post(initialize), setup("anthropic-cloud"))).status).toBe(200);
    const closed: string[] = [];
    const filler = (id: string, lastActive: number, inFlight = 0) => ({ transport: { close: async () => void closed.push(id) } as never, lastActive, inFlight });
    for (let index = openSessions().size; index < 300; index += 1) openSessions().set(`filler-${index}`, filler(`filler-${index}`, Date.now()));
    // The longest idle session is answering plan_room, so the next one goes.
    openSessions().set("busy-oldest", filler("busy-oldest", Date.now() - 20 * 60 * 1000, 1));
    openSessions().set("idle-oldest", filler("idle-oldest", Date.now() - 10 * 60 * 1000));
    openSessions().delete("filler-299");
    openSessions().delete("filler-298");
    expect(openSessions().size).toBe(300);

    const opened = await handleMcpRequest(post(initialize), setup("net-other"));
    expect(opened.status).toBe(200);
    expect(closed).toEqual(["idle-oldest"]);
    expect(openSessions().has("busy-oldest")).toBe(true);
    expect(openSessions().size).toBe(300);

    for (const session of openSessions().values()) session.inFlight = 1;
    const refused = await handleMcpRequest(post(initialize), setup("net-other"));
    expect(refused.status).toBe(503);
    expect(((await message(refused)).error as { message: string }).message).toBe("Roomover has 300 MCP sessions open and every one is answering a request, so try again in a few minutes.");

    const stale = Date.now() - 31 * 60 * 1000;
    for (const session of openSessions().values()) session.lastActive = stale;
    closeIdleSessions(Date.now());
    expect(openSessions().size).toBe(0);
  });

  it("counts a request as in flight until its answer stream ends", async () => {
    const opened = await handleMcpRequest(post(initialize), setup());
    const id = opened.headers.get("mcp-session-id") ?? "";
    await message(opened);
    const headers = { "mcp-session-id": id, "mcp-protocol-version": "2025-11-25" };
    await handleMcpRequest(post({ jsonrpc: "2.0", method: "notifications/initialized" }, headers), setup());
    const listed = await handleMcpRequest(post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, headers), setup());
    expect(openSessions().get(id)?.inFlight).toBe(1);
    await message(listed);
    expect(openSessions().get(id)?.inFlight).toBe(0);
  });
});
