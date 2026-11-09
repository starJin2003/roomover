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

async function connected(deps: McpDeps): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = buildMcpServer(deps, { buyerSession: "mcp-abcdefghijklmnopqrst", clientHash: "hash", logRunId: "11111111-1111-4111-8111-111111111111" });
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
    expect(meta).toMatchObject({ tool: "search_listings", client: "claude-code", blocked: false });
    expect(meta.latencyMs).toBeGreaterThanOrEqual(0);
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
  const setup = (clientHash = "net-a") => ({ deps: fakeDeps(), buyerSessionFor: (id: string) => `mcp-${id.replace(/-/g, "").slice(0, 20)}`, clientHash, allowedHosts: ["localhost:3100"] });

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

  it("caps the sessions one network holds open and closes idle ones", async () => {
    for (let index = 0; index < 30; index += 1) expect((await handleMcpRequest(post(initialize), setup("net-busy"))).status).toBe(200);
    const refused = await handleMcpRequest(post(initialize), setup("net-busy"));
    expect(refused.status).toBe(503);
    expect(((await message(refused)).error as { message: string }).message).toBe("Your network has too many Roomover MCP sessions open. Close one or wait 30 minutes.");
    expect((await handleMcpRequest(post(initialize), setup("net-other"))).status).toBe(200);
    closeIdleSessions(Date.now() + 31 * 60 * 1000);
    expect(openSessions().size).toBe(0);
  });
});
