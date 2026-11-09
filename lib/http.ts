import type { NextRequest } from "next/server";
import { z } from "zod";
import { RunConflictError, RunLimitError } from "@/lib/agents/limits";
import { readConfig } from "@/lib/config";
import { clientAddress, clientHash, SESSION_COOKIE, verifySession } from "@/lib/session";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function sessionFrom(request: NextRequest): string | null {
  return verifySession(request.cookies.get(SESSION_COOKIE)?.value, readConfig(["SESSION_SECRET"]).SESSION_SECRET);
}

export function clientHashFrom(request: NextRequest): string {
  return clientHash(clientAddress(request.headers), readConfig(["SESSION_SECRET"]).SESSION_SECRET);
}

export const planIdSchema = z.uuid();

/** Reads a JSON body against a schema, or answers 400 with what was wrong. */
export async function readBody<S extends z.ZodType>(request: NextRequest, schema: S): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: jsonResponse(400, { error: "The request body is not JSON." }) };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, response: jsonResponse(400, { error: z.prettifyError(parsed.error) }) };
}

/** Answers the two ways a run can be refused before it starts. */
export function runRefusal(error: unknown): Response | null {
  if (error instanceof RunLimitError) {
    return jsonResponse(429, { error: error.message, reason: error.decision.reason, retryAt: error.decision.retryAt.toISOString() }, {
      "Retry-After": String(Math.max(1, Math.ceil((error.decision.retryAt.getTime() - Date.now()) / 1000))),
    });
  }
  if (error instanceof RunConflictError) return jsonResponse(409, { error: error.message });
  return null;
}
