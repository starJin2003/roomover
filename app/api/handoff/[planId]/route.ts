import type { NextRequest } from "next/server";
import { handoffRequest, viewResponse } from "@/lib/handoff/http";

/** The handoff as it stands, for a screen that reconnects or reloads. */
export async function GET(request: NextRequest, context: RouteContext<"/api/handoff/[planId]">): Promise<Response> {
  const handoff = await handoffRequest(request, (await context.params).planId);
  return handoff instanceof Response ? handoff : viewResponse(handoff);
}
