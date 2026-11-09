import type { NextRequest } from "next/server";
import { readConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { latestDraft } from "@/lib/db/sell";
import { loadSeller } from "@/lib/db/sellers";
import { clientHashFrom, jsonResponse, runRefusal, sessionFrom } from "@/lib/http";
import { SELLER_COOKIE, verifySeller } from "@/lib/seller-session";
import { SellRefused, type SellDeps } from "./analyze";
import { sellView, type SellView } from "./view";

/** A reload shows the seller's newest draft from the last day, the same window the cleanup keeps. */
const DRAFT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function sellerIdFrom(request: NextRequest): string | null {
  return verifySeller(request.cookies.get(SELLER_COOKIE)?.value, readConfig(["SESSION_SECRET"]).SESSION_SECRET, new Date());
}

/** The signed in seller and the demo session, or the 401 a Sell route answers without them. */
export async function sellDepsFrom(request: NextRequest): Promise<SellDeps | Response> {
  const sellerId = sellerIdFrom(request);
  const sessionId = sessionFrom(request);
  if (sellerId === null || sessionId === null) return jsonResponse(401, { error: "Log in with PayPal to sell, so PayPal knows where to pay you." });
  const seller = await loadSeller(getDb(), sellerId);
  if (seller === null) return jsonResponse(401, { error: "Log in with PayPal again to sell." });
  return { db: getDb(), now: () => new Date(), sessionId, clientHash: clientHashFrom(request), seller };
}

export async function currentSellView(deps: Pick<SellDeps, "db" | "seller" | "sessionId" | "now">): Promise<SellView> {
  const now = deps.now();
  return sellView(deps.seller, await latestDraft(deps.db, deps.seller.id, deps.sessionId, new Date(now.getTime() - DRAFT_WINDOW_MS)), now);
}

/** The view after a step, so the screen always renders what the server holds. */
export async function sellViewResponse(deps: SellDeps, status = 200): Promise<Response> {
  return jsonResponse(status, { view: await currentSellView(deps) });
}

/** Answers a refused or failed step with its sentence and the current view. */
export async function sellFailure(deps: SellDeps, error: unknown): Promise<Response> {
  const refusal = runRefusal(error);
  if (refusal !== null) return refusal;
  if (error instanceof SellRefused) return jsonResponse(error.status, { error: error.message, view: await currentSellView(deps) });
  throw error;
}
