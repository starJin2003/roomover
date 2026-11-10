import { readPublicPhoto } from "@/lib/agents/verifier/facts";
import type { DisputeNoteFacts } from "@/lib/agents/verifier/dispute";
import type { Database } from "@/lib/db/client";
import { loadUploadedPhoto, type HandoffItem, type HandoffOrder } from "@/lib/db/handoffs";
import { LISTING_PHOTO_PATH, loadListingPhoto } from "@/lib/db/sell";
import { checkEvidenceFiles, EVIDENCE_LIMITS, type EvidenceContentType, type EvidenceKind } from "@/lib/domain/dispute";
import { formatSlot } from "@/lib/domain/handoff-slots";
import { damageWords } from "@/lib/domain/verdict";
import { formatUsdShort } from "@/lib/format";
import { sniffImage } from "@/lib/images";
import type { EvidenceFile } from "@/lib/paypal/rest/disputes";
import type { ActivityEventView } from "@/lib/plan-view";
import { textPdf } from "./pdf";

/**
 * The evidence Roomover holds for a disputed item, built from stored records
 * only: the listing photos, the buyer's own handoff photos, the verifier's
 * comparison, the buyer's confirmation, the agreed price and slot, the
 * PayPal IDs, and a timeline. Code writes every word of the record.
 */

export interface DisputeContext {
  order: HandoffOrder;
  /** The disputed item, or null when the disputed capture paid for the whole order. */
  item: HandoffItem | null;
  noun: string | null;
  buyerName: string;
  roomLabel: string;
  /** The listing's asking price before negotiation, by listing. */
  askingCents: ReadonlyMap<string, number>;
  events: readonly ActivityEventView[];
}

export interface DisputeRef {
  paypalDisputeId: string;
  reason: string;
  amountCents: number | null;
  stage: string | null;
}

const firstName = (name: string) => name.split(" ")[0];
const paidFor = (item: HandoffItem) => item.handoff?.payCents ?? item.capturedAmountCents;

function placeWords(item: HandoffItem, roomLabel: string): string {
  if (item.handoffMode === "storage_hold") return `collected from Lakeshore campus storage`;
  if (item.handoffMode === "same_room") return `left in ${roomLabel} for the next student`;
  return `handed over in person in ${roomLabel}`;
}

function findingWords(item: HandoffItem, buyer: string, noun: string): string {
  const report = item.handoff?.report ?? null;
  const found =
    report === null
      ? "No photo comparison is on record."
      : report.verdict === "match"
        ? `The verifier found that ${buyer}'s handoff photo matches the listing.`
        : report.verdict === "new_damage"
          ? `The verifier found a new ${report.damage === null ? "mark" : damageWords(report.damage)} in ${buyer}'s handoff photo.`
          : report.verdict === "wrong_item"
            ? `The verifier found that ${buyer}'s handoff photo shows a different item.`
            : `The verifier found that ${buyer}'s handoff photo does not show the item.`;
  const pay = formatUsdShort(paidFor(item));
  const decided: Record<string, string> = {
    accepted: `${buyer} confirmed the ${noun} at handoff and paid ${pay}.`,
    adjusted: `${buyer} kept the ${noun} at handoff and paid ${pay} of ${formatUsdShort(item.amountCents)}.`,
    rejected: `${buyer} turned the ${noun} down at handoff and paid nothing for it.`,
    missing: `${buyer} reported the ${noun} missing at handoff and paid nothing for it.`,
  };
  const decision = item.handoff?.decision ?? null;
  return `${found} ${decision === null ? `${buyer} has not confirmed the ${noun}.` : decided[decision]}`;
}

/** The facts the verifier writes its note from. Every amount the note may name is one of these. */
export function noteFacts(context: DisputeContext, dispute: DisputeRef): DisputeNoteFacts {
  const buyer = firstName(context.buyerName);
  const { item, order } = context;
  if (item === null) {
    const asking = order.items.reduce((sum, entry) => sum + (context.askingCents.get(entry.listingId) ?? entry.amountCents), 0);
    return {
      buyerFirstName: buyer,
      sellerFirstName: `${new Set(order.items.map((entry) => entry.sellerId)).size} students`,
      itemTitle: order.items.map((entry) => entry.title).join(", "),
      reason: dispute.reason,
      disputedCents: dispute.amountCents,
      askingCents: asking,
      agreedCents: order.totalCents,
      paidCents: order.items.reduce((sum, entry) => sum + paidFor(entry), 0),
      handoff: `Each item was handed over in person in ${context.roomLabel} or collected from campus storage, and ${buyer} photographed each one there.`,
      finding: order.items.map((entry) => findingWords(entry, buyer, entry.title.toLowerCase())).join(" "),
    };
  }
  const noun = context.noun ?? item.title.toLowerCase();
  const slot = item.handoff === null ? "" : `, ${formatSlot({ startsAt: item.handoff.slotStartsAt, endsAt: item.handoff.slotEndsAt })}`;
  return {
    buyerFirstName: buyer,
    sellerFirstName: firstName(item.sellerName),
    itemTitle: item.title,
    reason: dispute.reason,
    disputedCents: dispute.amountCents,
    askingCents: context.askingCents.get(item.listingId) ?? item.amountCents,
    agreedCents: item.amountCents,
    paidCents: paidFor(item),
    handoff: `The ${noun} was ${placeWords(item, context.roomLabel)}${slot}, and ${buyer} photographed it there.`,
    finding: findingWords(item, buyer, noun),
  };
}

/** The note code writes when the verifier gives no valid one, from the same facts. */
export function codeNote(facts: DisputeNoteFacts): string {
  return `${facts.buyerFirstName} bought ${facts.itemTitle} from ${facts.sellerFirstName} on Roomover for ${formatUsdShort(facts.agreedCents)}. ${facts.handoff} ${facts.finding}`.slice(0, 700);
}

/** The message code sends the buyer when the verifier gives no valid one, from the same facts. */
export function codeInquiryMessage(facts: DisputeNoteFacts): string {
  return `This is what Roomover's handoff record shows for ${facts.itemTitle} from ${facts.sellerFirstName}. ${facts.handoff} ${facts.finding} The agreed price was ${formatUsdShort(facts.agreedCents)}.`.slice(0, 700);
}

/** The verifier's note, then one line code writes about what is attached, inside PayPal's 2,000 characters. */
export function composeNotes(note: string, files: number): string {
  const attached = `Attached: ${files} ${files === 1 ? "file" : "files"} from Roomover's records, with the buyer's handoff photos, the listing photos, and a handoff record PDF that lists the PayPal IDs and the timeline.`;
  return `${note}\n\n${attached}`.slice(0, EVIDENCE_LIMITS.notes);
}

const TIMELINE_TOOLS = new Set(["checkout_approved", "compare_photos", "confirm_item", "capture_item", "refund_item", "money_settled", "send_payouts", "payouts_landed", "void_authorization", "reauthorize"]);

/** The order's own activity, oldest first, kept to the disputed item and the steps that moved its money. */
export function timelineOf(context: DisputeContext): { at: string; event: string }[] {
  const item = context.item;
  return context.events
    .filter((event) => TIMELINE_TOOLS.has(event.tool) && !event.blocked)
    .filter((event) => item === null || event.detail.orderItemId === undefined || event.detail.orderItemId === item.orderItemId)
    .filter((event) => item === null || event.detail.listingId === undefined || event.detail.listingId === item.listingId)
    .slice(-30)
    .map((event) => ({ at: event.at, event: event.summary }));
}

/** The handoff record PDF's lines: the dispute, the item, the handoff, the buyer's confirmation, every PayPal ID, and the timeline. */
export function recordLines(context: DisputeContext, dispute: DisputeRef, timeline: readonly { at: string; event: string }[]): string[] {
  const { order, item } = context;
  const items = item === null ? order.items : [item];
  const payoutItems = order.payout?.items ?? [];
  const lines = [
    `PayPal dispute ${dispute.paypalDisputeId}, reason ${dispute.reason}${dispute.stage === null ? "" : `, stage ${dispute.stage}`}${dispute.amountCents === null ? "" : `, ${formatUsdShort(dispute.amountCents)} disputed`}.`,
    `Buyer: ${context.buyerName}, ${context.roomLabel}. Roomover order ${order.id}.`,
    `PayPal order ${order.paypalOrderId ?? "none"}${order.paypalAuthorizationId === null ? "" : `, authorization ${order.paypalAuthorizationId}`}${order.paypalReauthorizationId === null ? "" : `, reauthorization ${order.paypalReauthorizationId}`}${order.paypalCaptureId === null ? "" : `, checkout capture ${order.paypalCaptureId}`}.`,
    `Payout batch ${order.payout?.paypalBatchId ?? "none"}.`,
    "",
  ];
  for (const entry of items) {
    const handoff = entry.handoff;
    const payout = payoutItems.find((payoutItem) => payoutItem.sellerId === entry.sellerId);
    const report = handoff?.report ?? null;
    lines.push(
      `Item: ${entry.title}, sold by ${entry.sellerName}.`,
      `Asking ${formatUsdShort(context.askingCents.get(entry.listingId) ?? entry.amountCents)}, agreed ${formatUsdShort(entry.amountCents)}, paid at handoff ${formatUsdShort(paidFor(entry))}.`,
      handoff === null ? "No handoff is on record." : `Handoff ${formatSlot({ startsAt: handoff.slotStartsAt, endsAt: handoff.slotEndsAt })} at ${handoff.location}, ${handoff.photos.length} buyer ${handoff.photos.length === 1 ? "photo" : "photos"}.`,
      report === null ? "No photo comparison." : `Verifier: ${report.verdict}${report.damage === null ? "" : `, ${damageWords(report.damage)} at ${report.damage.location}, ${report.damage.severity}`}, confidence ${report.confidence}. ${report.observations}`,
      handoff?.decision === null || handoff?.decision === undefined ? "Not confirmed by the buyer." : `Buyer's confirmation: ${handoff.decision}${handoff.decidedAt === null ? "" : ` at ${handoff.decidedAt.toISOString()}`}.`,
      `Capture ${entry.paypalCaptureId ?? "none"}${entry.paypalRefundId === null ? "" : `, refund ${entry.paypalRefundId}`}${payout === undefined ? "" : `, payout item ${payout.paypalPayoutItemId ?? "pending"} to ${payout.sellerName}`}.`,
      "",
    );
  }
  lines.push("Timeline:", ...timeline.map((entry) => `${entry.at}  ${entry.event}`));
  return lines;
}

export interface BuiltFile extends EvidenceFile {
  source: "listing_photo" | "handoff_photo" | "handoff_record";
}

/** PayPal document names allow letters, digits, spaces, hyphens, underscores, and commas. */
const fileWord = (text: string) => text.replace(/[^A-Za-z0-9\- ]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || "item";

async function photoBytes(db: Database, src: string, sessionId: string | null): Promise<Buffer | null> {
  try {
    if (src.startsWith(LISTING_PHOTO_PATH)) return (await loadListingPhoto(db, src.slice(LISTING_PHOTO_PATH.length)))?.bytes ?? null;
    if (src.startsWith("/api/handoff/photos/")) return sessionId === null ? null : ((await loadUploadedPhoto(db, src.split("/").at(-1) ?? "", sessionId))?.bytes ?? null);
    return await readPublicPhoto(src);
  } catch {
    return null;
  }
}

/**
 * The files for one dispute: the buyer's handoff photos first, then the
 * listing photos, then the record. Files PayPal would refuse stay out, each
 * with its reason.
 */
export async function evidenceFiles(db: Database, context: DisputeContext, recordPdf: Uint8Array<ArrayBuffer>): Promise<{ files: BuiltFile[]; skipped: { name: string; reason: string }[] }> {
  const items = context.item === null ? context.order.items : [context.item];
  const candidates: { name: string; src: string; source: BuiltFile["source"] }[] = [];
  const count = { handoff_photo: 0, listing_photo: 0 };
  const add = (kind: "handoff_photo" | "listing_photo", src: string, word: string) => {
    count[kind] += 1;
    candidates.push({ name: `${kind === "handoff_photo" ? "handoff" : "listing"} photo ${count[kind]}, ${word}`, src, source: kind });
  };
  for (const entry of items) {
    const word = fileWord(context.item === null ? entry.title : (context.noun ?? entry.title));
    for (const photo of entry.handoff?.photos ?? []) add("handoff_photo", photo.src, word);
    for (const photo of entry.photos) add("listing_photo", photo.src, word);
  }
  const loaded: BuiltFile[] = [];
  const unreadable: { name: string; reason: string }[] = [];
  for (const candidate of candidates) {
    const bytes = await photoBytes(db, candidate.src, context.order.sessionId);
    const type = bytes === null ? null : sniffImage(bytes);
    if (bytes === null || type === null) {
      unreadable.push({ name: candidate.name, reason: "Roomover could not read the photo." });
      continue;
    }
    const extension = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    // A WebP photo keeps its type here, and the check below leaves it out with PayPal's reason.
    loaded.push({ filename: `${candidate.name}.${extension}`, contentType: type as EvidenceContentType, data: new Uint8Array(bytes), source: candidate.source });
  }
  // The record goes first in the check, so it always has a place in the bundle.
  const record: BuiltFile = { filename: "handoff record.pdf", contentType: "application/pdf", data: recordPdf, source: "handoff_record" };
  const all = [record, ...loaded];
  const checked = checkEvidenceFiles(all.map((file) => ({ name: file.filename, contentType: file.contentType as string, bytes: file.data.byteLength })));
  const kept = new Set(checked.accepted.map((file) => file.name));
  const accepted = all.filter((file) => kept.has(file.filename));
  return { files: [...accepted.filter((file) => file.source !== "handoff_record"), ...accepted.filter((file) => file.source === "handoff_record")], skipped: [...unreadable, ...checked.skipped] };
}

export function recordPdf(context: DisputeContext, dispute: DisputeRef, timeline: readonly { at: string; event: string }[]): Uint8Array<ArrayBuffer> {
  return textPdf("Roomover handoff record", recordLines(context, dispute, timeline));
}

export const KIND_WORDS: Readonly<Record<EvidenceKind, string>> = {
  handoff_record: "the handoff record",
  item_description: "the listing and the handoff record",
  proof_of_refund: "the refund and the handoff record",
};
