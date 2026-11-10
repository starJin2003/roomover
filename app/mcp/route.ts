import { connection, type NextRequest } from "next/server";
import { readConfig } from "@/lib/config";
import { clientHashFrom } from "@/lib/http";
import { isAnthropicAddress } from "@/lib/domain/mcp";
import { clientAddress, mcpBuyerSession } from "@/lib/session";
import { liveMcpDeps } from "@/mcp/deps";
import { handleMcpRequest } from "@/mcp/sessions";

/** The hosts this deploy answers on, plus both local names when it runs on a laptop. */
function allowedHosts(appUrl: string): string[] {
  const { host, port } = new URL(appUrl);
  return port === "" ? [host] : [host, `localhost:${port}`, `127.0.0.1:${port}`];
}

/**
 * Roomover's MCP server over streamable HTTP. POST carries requests, GET
 * opens a session's notification stream, and DELETE ends a session.
 */
async function handle(request: NextRequest): Promise<Response> {
  await connection();
  const { APP_URL, SESSION_SECRET } = readConfig(["APP_URL", "SESSION_SECRET"]);
  return handleMcpRequest(request, {
    deps: liveMcpDeps(),
    buyerSessionFor: (id) => mcpBuyerSession(id, SESSION_SECRET),
    clientHash: clientHashFrom(request),
    fromAnthropic: isAnthropicAddress(clientAddress(request.headers)),
    allowedHosts: allowedHosts(APP_URL),
  });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
