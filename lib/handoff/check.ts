import { eq } from "drizzle-orm";
import { publish } from "@/lib/agents/bus";
import { decideComparisonLimit, RunLimitError } from "@/lib/agents/limits";
import { comparePhotos } from "@/lib/agents/verifier/compare";
import { listingFacts, photoData, readPublicPhoto, sha256 } from "@/lib/agents/verifier/facts";
import { verifierTransportFor } from "@/lib/agents/verifier/transport";
import type { Database } from "@/lib/db/client";
import { addHandoffPhoto, comparisonsSince, insertHandoffEvents, loadHandoffOrder, loadUploadedPhoto, markVerifying, recordDecision, recordVerdict, recordVerifierError, storeUploadedPhoto, type HandoffItem, type HandoffOrder } from "@/lib/db/handoffs";
import { claudeCallsToday } from "@/lib/db/plans";
import { plans } from "@/lib/db/schema";
import { planLayoutSchema } from "@/lib/domain/layout";
import { ChoiceRefused, settleChoice, type Finding, type HandoffChoice } from "@/lib/domain/money-policy";
import { canCheck } from "@/lib/domain/order-state";
import type { PhotoData } from "@/lib/agents/verifier/prompt";
import { listingPhotoBytes } from "@/lib/sell/photos";
import { sampleFor, type SampleKind } from "./samples";
import { decisionSentence, findingSentence, firstNameOf, shortNoun, type ItemWords } from "./words";

const HOUR_MS = 60 * 60 * 1000;

/** Why a handoff step was refused, with a sentence for the student and an HTTP status for the route. */
export class HandoffRefused extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "HandoffRefused";
  }
}

export type PhotoInput =
  | { kind: "upload"; bytes: Buffer; contentType: "image/jpeg" | "image/png" | "image/webp" }
  | { kind: "sample"; sample: SampleKind }
  | { kind: "retry" };

export interface CheckDeps {
  db: Database;
  now: () => Date;
  sessionId: string;
}

type OpenItem = HandoffItem & { handoff: NonNullable<HandoffItem["handoff"]> };

/** The item's words for the panel, with the noun the plan's layout gives it, such as chair. */
async function wordsFor(db: Database, planId: string, item: HandoffItem): Promise<ItemWords> {
  const [row] = await db.select({ layout: plans.layout }).from(plans).where(eq(plans.id, planId));
  const placed = row === undefined ? undefined : planLayoutSchema.parse(row.layout).items.find((entry) => entry.source === "listing" && entry.listingId === item.listingId);
  return { sellerFirstName: firstNameOf(item.sellerName), noun: placed === undefined ? item.title.toLowerCase() : shortNoun(placed), priceCents: item.amountCents };
}

async function openItem(db: Database, planId: string, orderItemId: string): Promise<{ order: HandoffOrder; item: OpenItem; words: ItemWords }> {
  const order = await loadHandoffOrder(db, planId);
  if (order === null) throw new HandoffRefused(404, "This room has no paid order to hand off.");
  const item = order.items.find((candidate) => candidate.orderItemId === orderItemId);
  if (item === undefined || item.handoff === null) throw new HandoffRefused(404, "That item is not part of this handoff.");
  if (!canCheck(order.status)) throw new HandoffRefused(409, "This handoff is finished, so its items stay as they are.");
  if (item.handoff.decision !== null) throw new HandoffRefused(409, "You already confirmed this item.");
  return { order, item: { ...item, handoff: item.handoff }, words: await wordsFor(db, planId, item) };
}

/** The bytes of the photo the item was last checked with, from the sample files or the upload table. */
async function latestPhotoBytes(db: Database, sessionId: string, item: OpenItem): Promise<{ bytes: Buffer; data: PhotoData } | null> {
  const photo = item.handoff.photos.at(-1);
  if (photo === undefined) return null;
  if (photo.source === "sample") {
    const bytes = await readPublicPhoto(photo.src);
    return { bytes, data: photoData(bytes, "image/jpeg") };
  }
  const id = photo.src.split("/").at(-1) ?? "";
  const stored = await loadUploadedPhoto(db, id, sessionId);
  if (stored === null) return null;
  return { bytes: stored.bytes, data: photoData(stored.bytes, stored.contentType as PhotoData["mediaType"]) };
}

/**
 * Takes a handoff photo for one item and runs the verifier on it. The
 * comparison runs in this request, and the verdict or a visible failure is
 * stored before it returns.
 */
export async function checkPhoto(deps: CheckDeps, planId: string, orderItemId: string, input: PhotoInput): Promise<void> {
  const { db, sessionId } = deps;
  const { order, item, words } = await openItem(db, planId, orderItemId);
  const now = deps.now();

  let handoffPhoto: { bytes: Buffer; data: PhotoData } | null;
  if (input.kind === "retry") {
    handoffPhoto = await latestPhotoBytes(db, sessionId, item);
    if (handoffPhoto === null) throw new HandoffRefused(422, "Take a photo of the item first.");
  } else if (input.kind === "sample") {
    const sample = sampleFor(item.photos[0].src, input.sample);
    if (sample === undefined) throw new HandoffRefused(422, "This item has no sample photo of that kind.");
    const bytes = await readPublicPhoto(sample.src);
    handoffPhoto = { bytes, data: photoData(bytes, "image/jpeg") };
  } else {
    handoffPhoto = { bytes: input.bytes, data: photoData(input.bytes, input.contentType) };
  }

  const key = sha256(handoffPhoto.bytes);
  const { mode, transport } = await verifierTransportFor(key);
  if (mode === "live") {
    const decision = decideComparisonLimit({ session: await comparisonsSince(db, sessionId, new Date(now.getTime() - HOUR_MS)), claudeCallsToday: await claudeCallsToday(db, now) }, now);
    if (!decision.allowed) throw new RunLimitError(decision);
  }

  if (input.kind === "retry") {
    await markVerifying(db, item.handoff.id);
  } else {
    const src = input.kind === "sample" ? (sampleFor(item.photos[0].src, input.sample)?.src as string) : `/api/handoff/photos/${await storeUploadedPhoto(db, { handoffId: item.handoff.id, sessionId, contentType: input.contentType, bytes: input.bytes, sha256: key })}`;
    const added = await addHandoffPhoto(db, item.handoff.id, { src, source: input.kind === "sample" ? "sample" : "upload", takenAt: now.toISOString() });
    if (!added) throw new HandoffRefused(409, "You already confirmed this item.");
  }
  publish(planId, { type: "handoff" });

  const listingPhotos = await Promise.all(item.photos.map(async (photo) => (await listingPhotoBytes(db, photo.src)).data));
  let result: Awaited<ReturnType<typeof comparePhotos>>;
  try {
    result = await comparePhotos(transport, listingFacts(item), listingPhotos, handoffPhoto.data);
  } catch (error) {
    console.error("verifier call failed", { orderItemId, error: error instanceof Error ? error.name : "unknown" });
    result = { ok: false, error: "The verifier could not reach Claude just now. Try again in a moment.", usage: { calls: mode === "live" ? 1 : 0, inputTokens: 0, outputTokens: 0 } };
  }
  const calls = mode === "live" ? result.usage.calls : 0;
  const usage = { claudeCalls: calls, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, orderItemId };

  if (result.ok) {
    await recordVerdict(db, item.handoff.id, { ...result.verdict, model: result.model, attempts: result.attempts, comparedAt: deps.now().toISOString() });
    await insertHandoffEvents(db, order, "verifier", [
      {
        tool: "compare_photos",
        sentence: findingSentence(words, result.verdict.verdict, result.verdict.damage),
        summary: `Compared ${item.photos.length} listing photo${item.photos.length === 1 ? "" : "s"} with the handoff photo of ${item.title} in ${result.attempts} call${result.attempts === 1 ? "" : "s"}: ${result.verdict.verdict}, confidence ${result.verdict.confidence}. ${result.verdict.observations}`,
        detail: { ...usage, listingId: item.listingId },
      },
    ]);
  } else {
    await recordVerifierError(db, item.handoff.id, result.error);
    await insertHandoffEvents(db, order, "verifier", [{ tool: "compare_photos", summary: `No verdict for ${item.title}. ${result.error}`, blocked: true, detail: { ...usage, listingId: item.listingId } }]);
  }
  publish(planId, { type: "handoff" });
}

/**
 * Confirms the student's choice for one item. Code reads the verdict and
 * the price and decides the amount, so the tap moves no money yet.
 */
export async function confirmChoice(deps: CheckDeps, planId: string, orderItemId: string, choice: HandoffChoice): Promise<void> {
  const { db } = deps;
  const { order, item, words } = await openItem(db, planId, orderItemId);
  const report = item.handoff.report;
  const finding: Finding = report === null ? { verdict: "none" } : report.verdict === "new_damage" ? { verdict: "new_damage", damage: { severity: report.damage?.severity ?? "minor" } } : { verdict: report.verdict };
  if (report === null && item.handoff.status === "verifying") throw new HandoffRefused(409, "The verifier is still comparing this photo.");

  let settled: ReturnType<typeof settleChoice>;
  try {
    settled = settleChoice(finding, choice, item.amountCents);
  } catch (error) {
    if (error instanceof ChoiceRefused) throw new HandoffRefused(422, "That choice is not offered for this item.");
    throw error;
  }
  const recorded = await recordDecision(db, item.handoff.id, settled.decision, settled.payCents, deps.now());
  if (!recorded) throw new HandoffRefused(409, "You already confirmed this item.");
  await insertHandoffEvents(db, order, "platform", [
    {
      tool: "confirm_item",
      sentence: decisionSentence(words, settled.decision, settled.payCents),
      summary: `The student chose ${choice} for ${item.title}: ${settled.decision}, pay ${settled.payCents} of ${item.amountCents} cents, release ${settled.releasedCents}.`,
      detail: { orderItemId, listingId: item.listingId, priceCents: settled.payCents },
    },
  ]);
  publish(planId, { type: "handoff" });
}
