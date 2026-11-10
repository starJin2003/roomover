import { randomUUID } from "node:crypto";
import { isInitializeRequest, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { decideMcpSessionOpen, MCP_LIMITS } from "@/lib/domain/mcp";
import type { McpDeps } from "./deps";
import { buildMcpServer } from "./server";

/**
 * MCP sessions over streamable HTTP. An initialize request opens a session
 * with its own transport, McpServer, and demo buyer session, and every later
 * request carries the Mcp-Session-Id that routes it back. The web service
 * runs one instance, so the registry lives in memory, and a restart sends
 * clients a 404 that tells them to start a new session.
 */

interface OpenSession {
  transport: WebStandardStreamableHTTPServerTransport;
  lastActive: number;
  /** POST requests still answering. A session with none is idle and may make room for a new one. */
  inFlight: number;
}

export interface McpSessionSetup {
  deps: McpDeps;
  /** The keyed buyer session an MCP session acts through. */
  buyerSessionFor(mcpSessionId: string): string;
  clientHash: string;
  /** Whether the initialize request came from Anthropic's outbound ranges, as Claude app connectors do. */
  fromAnthropic: boolean;
  /** Hosts the endpoint answers for, which stops DNS rebinding from a browser. */
  allowedHosts: string[];
  now?: () => number;
}

const store = globalThis as typeof globalThis & { roomoverMcpSessions?: Map<string, OpenSession> };

export function openSessions(): Map<string, OpenSession> {
  store.roomoverMcpSessions ??= new Map();
  return store.roomoverMcpSessions;
}

const rpcError = (status: number, code: number, message: string) => Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status, headers: { "Cache-Control": "no-store" } });

/** Closes sessions that saw no request for the idle time, which also frees their place under the caps. */
export function closeIdleSessions(now: number): void {
  for (const [id, session] of openSessions()) {
    if (now - session.lastActive >= MCP_LIMITS.idleMs) closeSession(id);
  }
}

function closeSession(id: string): void {
  const session = openSessions().get(id);
  openSessions().delete(id);
  void session?.transport.close().catch(() => undefined);
}

/**
 * Counts a POST as in flight until its answer stream ends or the client
 * leaves. A GET opens the session's notification stream, which stays open
 * and does not count.
 */
async function answer(session: OpenSession, request: Request): Promise<Response> {
  if (request.method !== "POST") return session.transport.handleRequest(request);
  session.inFlight += 1;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    session.inFlight -= 1;
  };
  let response: Response;
  try {
    response = await session.transport.handleRequest(request);
  } catch (error) {
    finish();
    throw error;
  }
  if (response.body === null) {
    finish();
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          finish();
          controller.close();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    cancel(reason) {
      finish();
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export async function handleMcpRequest(request: Request, setup: McpSessionSetup): Promise<Response> {
  const now = setup.now?.() ?? Date.now();
  closeIdleSessions(now);
  const sessionId = request.headers.get("mcp-session-id");
  if (sessionId !== null) {
    const session = openSessions().get(sessionId);
    if (session === undefined) return rpcError(404, -32001, "Session not found. Start a new session with initialize.");
    session.lastActive = now;
    return answer(session, request);
  }
  if (request.method !== "POST") return rpcError(400, -32000, "Bad Request: send Mcp-Session-Id, or POST initialize to start a session.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(400, -32700, "Parse error: the body is not JSON.");
  }
  if (!isInitializeRequest(body)) return rpcError(400, -32000, "Bad Request: send Mcp-Session-Id, or POST initialize to start a session.");

  const decision = decideMcpSessionOpen([...openSessions()].map(([id, session]) => ({ id, lastActive: session.lastActive, inFlight: session.inFlight })));
  if (decision.action === "refuse") return rpcError(503, -32000, decision.message);
  if (decision.action === "evict") closeSession(decision.sessionId);

  const id = randomUUID();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => id,
    onsessioninitialized: () => {
      openSessions().set(id, { transport, lastActive: now, inFlight: 0 });
    },
    onsessionclosed: () => {
      openSessions().delete(id);
    },
    allowedHosts: setup.allowedHosts,
    enableDnsRebindingProtection: true,
    // plan_room runs for up to a few minutes, and a comment every 15 s keeps proxies from closing the stream.
    keepAliveMs: 15_000,
  });
  transport.onclose = () => {
    openSessions().delete(id);
  };
  // Each session's MCP lines share one run ID, so its calls read as one conversation in agent_events.
  const server = buildMcpServer(setup.deps, { buyerSession: setup.buyerSessionFor(id), clientHash: setup.clientHash, fromAnthropic: setup.fromAnthropic, logRunId: randomUUID() });
  await server.connect(transport);
  return transport.handleRequest(request, { parsedBody: body });
}
