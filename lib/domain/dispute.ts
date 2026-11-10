import { z } from "zod";
import type { DisputeEvidenceState, DisputeMessageState, DisputeStatus } from "./enums";
import { formatUsdShort } from "@/lib/format";

/**
 * Disputes a buyer opens in PayPal on a settled Roomover order. PayPal runs
 * the dispute. Code reads it, decides whether Roomover owes evidence and of
 * which kind, builds the evidence from records Roomover already holds, and
 * says where things stand in plain words. No step accepts a claim, offers a
 * refund, or moves money.
 */

/** PayPal's dispute `status`, from the Disputes API 1.11 spec. */
export const PAYPAL_DISPUTE_STATUSES = ["OPEN", "WAITING_FOR_BUYER_RESPONSE", "WAITING_FOR_SELLER_RESPONSE", "UNDER_REVIEW", "RESOLVED", "OTHER"] as const;

/** PayPal's dispute `reason`, from the Disputes API 1.11 spec. */
export const DISPUTE_REASONS = [
  "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
  "UNAUTHORISED",
  "CREDIT_NOT_PROCESSED",
  "DUPLICATE_TRANSACTION",
  "INCORRECT_AMOUNT",
  "PAYMENT_BY_OTHER_MEANS",
  "CANCELED_RECURRING_BILLING",
  "PROBLEM_WITH_REMITTANCE",
  "OTHER",
] as const;

export function disputeStatusFrom(paypalStatus: string): DisputeStatus {
  const known = (PAYPAL_DISPUTE_STATUSES as readonly string[]).includes(paypalStatus);
  return known ? (paypalStatus.toLowerCase() as DisputeStatus) : "other";
}

/**
 * What Roomover sends. A handoff record answers most reasons: the buyer's own
 * photo at handoff, the buyer's confirmation, and the PayPal IDs. A claim that
 * the item differs from its listing also gets the listing photos, and a
 * claim about a missing credit gets the refund IDs when Roomover refunded.
 */
export type EvidenceKind = "handoff_record" | "item_description" | "proof_of_refund";

const KIND_TYPE: Readonly<Record<EvidenceKind, string>> = { handoff_record: "OTHER", item_description: "ITEM_DESCRIPTION", proof_of_refund: "PROOF_OF_REFUND" };

/** Evidence types that need tracking or return details Roomover never has, since every handoff happens in person. */
const NEEDS_SHIPPING = new Set(["PROOF_OF_FULFILLMENT", "PROOF_OF_RETURN", "PROOF_OF_RESHIPMENT", "ONLINE_TRACKING_INFORMATION", "ADDITIONAL_TRACKING_INFORMATION", "RETURN_TRACKING_INFORMATION", "PROOF_OF_SHIPMENT_POSTAGE"]);

export interface DisputeFacts {
  /** PayPal's status, such as WAITING_FOR_SELLER_RESPONSE. */
  status: string;
  /** PayPal's dispute_life_cycle_stage, such as INQUIRY. */
  stage: string | null;
  reason: string;
  /** Evidence types PayPal asked the seller for, from `evidences[].source` REQUESTED_FROM_SELLER. */
  requested: readonly string[];
  /** The dispute carries a provide-evidence link, which PayPal requires for a submission. */
  canProvideEvidence: boolean;
  /** Refunds Roomover made on the disputed item. */
  refundIds: readonly string[];
}

export interface EvidenceHistory {
  state: DisputeEvidenceState;
  /** The lifecycle stage the last submission went in for. */
  stage: string | null;
}

export type EvidenceDecision = { due: false; why: string } | { due: true; kind: EvidenceKind; evidenceType: string; why: string };

function kindFor(facts: DisputeFacts): EvidenceKind {
  if (facts.reason === "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED") return "item_description";
  const aboutMoney = facts.reason === "CREDIT_NOT_PROCESSED" || facts.reason === "INCORRECT_AMOUNT" || facts.reason === "DUPLICATE_TRANSACTION";
  if (aboutMoney && facts.refundIds.length > 0) return "proof_of_refund";
  return "handoff_record";
}

/**
 * Whether Roomover owes evidence now, and which. PayPal takes seller evidence
 * only while the dispute waits for the seller and carries a provide-evidence
 * link. One submission goes in per lifecycle stage, so an escalation that
 * asks again gets a new one. A requested type Roomover can back with
 * documents and notes replaces the default type for the reason.
 */
export function decideEvidence(facts: DisputeFacts, history: EvidenceHistory): EvidenceDecision {
  if (facts.status === "RESOLVED") return { due: false, why: "The dispute is resolved." };
  if (history.state === "sending") return { due: false, why: "A submission is already on its way to PayPal." };
  if (history.state === "sent" && history.stage === facts.stage) return { due: false, why: `Roomover already sent evidence for the ${facts.stage ?? "current"} stage.` };
  if (facts.status === "WAITING_FOR_BUYER_RESPONSE") return { due: false, why: "PayPal is waiting for the buyer." };
  if (facts.status === "UNDER_REVIEW") return { due: false, why: "PayPal is reviewing the dispute." };
  if (facts.status !== "WAITING_FOR_SELLER_RESPONSE") return { due: false, why: "PayPal has not asked the seller for evidence." };
  if (!facts.canProvideEvidence) return { due: false, why: "PayPal offers no provide-evidence link on the dispute right now." };
  const kind = kindFor(facts);
  const requested = facts.requested.find((type) => !NEEDS_SHIPPING.has(type) && (type !== "PROOF_OF_REFUND" || kind === "proof_of_refund"));
  const evidenceType = requested ?? KIND_TYPE[kind];
  return { due: true, kind, evidenceType, why: requested === undefined ? `The reason is ${facts.reason}.` : `PayPal asked the seller for ${requested}.` };
}

/** The file types PayPal accepts for dispute documents. */
export const EVIDENCE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/gif", "application/pdf"] as const;
export type EvidenceContentType = (typeof EVIDENCE_CONTENT_TYPES)[number];

/** PayPal's document rules, as its dispute filing page states them: at most 10 files, 10 MB each, 50 MB in total. */
export const EVIDENCE_LIMITS = {
  fileBytes: 10 * 1024 * 1024,
  requestBytes: 50 * 1024 * 1024,
  files: 10,
  /** The Disputes API limit on `notes`. */
  notes: 2000,
} as const;

/** PayPal's document name pattern: letters, digits, hyphens, underscores, commas, or spaces, then one extension. */
export const DOCUMENT_NAME = /^[A-Za-z0-9\-_,\s]+\.[A-Za-z]+$/;

export interface CandidateFile {
  name: string;
  contentType: string;
  bytes: number;
}

/** Keeps the files PayPal accepts, in order, and says why each other one stayed out. */
export function checkEvidenceFiles<T extends CandidateFile>(files: readonly T[]): { accepted: T[]; skipped: { name: string; reason: string }[] } {
  const accepted: T[] = [];
  const skipped: { name: string; reason: string }[] = [];
  let total = 0;
  for (const file of files) {
    let reason: string | null = null;
    if (!(EVIDENCE_CONTENT_TYPES as readonly string[]).includes(file.contentType)) reason = "PayPal takes JPEG, PNG, GIF, or PDF files.";
    else if (!DOCUMENT_NAME.test(file.name)) reason = "PayPal does not accept that file name.";
    else if (file.bytes <= 0 || file.bytes >= EVIDENCE_LIMITS.fileBytes) reason = "Each file must be under 10 MB.";
    else if (total + file.bytes > EVIDENCE_LIMITS.requestBytes) reason = "The files would pass 50 MB in one call.";
    else if (accepted.length >= EVIDENCE_LIMITS.files) reason = `A bundle holds at most ${EVIDENCE_LIMITS.files} files.`;
    if (reason === null) {
      accepted.push(file);
      total += file.bytes;
    } else skipped.push({ name: file.name, reason });
  }
  return { accepted, skipped };
}

/** The verifier's note goes in ahead of the record line code writes, inside PayPal's 2,000 characters. */
export const NOTE_MAX = 700;

export const disputeNoteSchema = z.strictObject({
  note: z.string().trim().min(40).max(NOTE_MAX).describe("Two to four short sentences of fact for PayPal's reviewer, in the third person."),
});

const AMOUNT = /\$\s?\d[\d,]*(?:\.\d{1,2})?|\b\d+(?:\.\d{1,2})?\s?(?:USD|dollars?)\b/gi;

function amountCents(text: string): number {
  return Math.round(Number(text.replace(/[^0-9.]/g, "")) * 100);
}

/** Problems with a note: any amount code did not give the verifier. An empty list means the note stands. */
export function noteProblems(note: string, allowedCents: readonly number[]): string[] {
  const found = note.match(AMOUNT) ?? [];
  const unknown = found.filter((text) => !allowedCents.includes(amountCents(text)));
  return unknown.length === 0 ? [] : [`The note names ${unknown.join(", ")}, which is not one of the amounts given (${allowedCents.map(formatUsdShort).join(", ")}). Use only those amounts or none.`];
}

/**
 * Whether Roomover sends its one message to the buyer now. PayPal takes
 * messages only in the inquiry stage and only while the dispute carries a
 * send-message link. A message on its way or sent ends it, and one PayPal
 * refused goes again on the dispute's next update.
 */
export function decideInquiryMessage(facts: { status: string; stage: string | null; canSendMessage: boolean }, state: DisputeMessageState | null): { due: true } | { due: false; why: string } {
  if (state === "sent") return { due: false, why: "Roomover already sent its message for this dispute." };
  if (state === "sending") return { due: false, why: "Roomover's message is already on its way to PayPal." };
  if (facts.status === "RESOLVED") return { due: false, why: "The dispute is resolved." };
  if (facts.stage !== "INQUIRY") return { due: false, why: "PayPal takes messages only while a dispute is an inquiry." };
  if (!facts.canSendMessage) return { due: false, why: "PayPal offers no send-message link on the dispute right now." };
  return { due: true };
}

/** The line code adds under the verifier's message, so the promise about escalation is always in code's words. */
export const INQUIRY_CLOSING = "If the case is escalated, Roomover will send PayPal the listing photos, your handoff photos, and the handoff record.";

/** The Disputes API limit on a message's text. */
export const MESSAGE_LIMIT = 2000;

export const inquiryMessageSchema = z.strictObject({
  message: z.string().trim().min(40).max(NOTE_MAX).describe("Two to four short sentences to the buyer, in the second person, saying what Roomover's handoff record shows."),
});

const PROMISE = /\b(refund\w*|reimburs\w*|compensat\w*|offer\w*|money back|goodwill|accept\w*\s+(?:the|your)\s+(?:claim|dispute))\b/gi;

/** Problems with a message to the buyer: an amount code did not give, or any offer, refund, or accepted claim. */
export function messageProblems(message: string, allowedCents: readonly number[]): string[] {
  const promises = [...new Set((message.match(PROMISE) ?? []).map((word) => word.toLowerCase()))];
  return [
    ...noteProblems(message, allowedCents),
    ...(promises.length === 0 ? [] : [`The message says ${promises.map((word) => `"${word}"`).join(", ")}. State the record's facts only, with no offer, refund, or accepted claim.`]),
  ];
}

/** The verifier's message, then code's closing line, inside PayPal's 2,000 characters. */
export function composeInquiryMessage(body: string): string {
  return `${body}\n\n${INQUIRY_CLOSING}`.slice(0, MESSAGE_LIMIT);
}

const EVIDENCE_SOURCES = ["listing_photo", "handoff_photo", "handoff_record"] as const;

/** What Roomover sent PayPal for one dispute, kept with the dispute row. */
export const evidenceBundleSchema = z.strictObject({
  kind: z.enum(["handoff_record", "item_description", "proof_of_refund"]),
  evidenceType: z.string().regex(/^[0-9A-Z_]+$/),
  notes: z.string().min(1).max(EVIDENCE_LIMITS.notes),
  /** The verifier's own note, or null when code wrote the summary because the verifier gave no valid one. */
  verifierNote: z.string().min(1).max(NOTE_MAX).nullable(),
  files: z
    .array(z.strictObject({ name: z.string().regex(DOCUMENT_NAME), contentType: z.enum(EVIDENCE_CONTENT_TYPES), bytes: z.number().int().positive(), source: z.enum(EVIDENCE_SOURCES) }))
    .min(1)
    .max(EVIDENCE_LIMITS.files),
  skipped: z.array(z.strictObject({ name: z.string().min(1), reason: z.string().min(1) })),
  refundIds: z.array(z.string().min(1)),
  timeline: z.array(z.strictObject({ at: z.iso.datetime({ offset: true }), event: z.string().min(1) })).min(1),
});

export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;

export type DisputeUpdateStep = "insert" | "apply" | "same" | "stale";

/**
 * Where a dispute report lands against what Roomover holds. A resolved
 * dispute stays resolved, and a report PayPal stamped earlier than the one
 * held changes nothing, so redelivered and out of order webhooks are safe.
 */
export function disputeUpdateStep(current: { status: DisputeStatus; paypalUpdatedAt: Date | null } | null, incoming: { status: DisputeStatus; updatedAt: Date | null }): DisputeUpdateStep {
  if (current === null) return "insert";
  if (current.status === "resolved" && incoming.status !== "resolved") return "stale";
  if (current.paypalUpdatedAt !== null && incoming.updatedAt !== null) {
    if (incoming.updatedAt < current.paypalUpdatedAt) return "stale";
    if (incoming.updatedAt.getTime() === current.paypalUpdatedAt.getTime() && incoming.status === current.status) return "same";
  }
  return "apply";
}

/**
 * Roomover's evidence state after a report lands. PayPal waiting for the
 * seller makes evidence due, unless a submission is on its way or already
 * went in for this stage. Nothing else moves the state here, since only the
 * dispute run sends and records evidence.
 */
export function evidenceStateOnReport(current: { state: DisputeEvidenceState; stage: string | null } | null, report: { evidenceDue: boolean; stage: string | null }): DisputeEvidenceState {
  if (current === null) return report.evidenceDue ? "due" : "not_due";
  if (!report.evidenceDue) return current.state;
  if (current.state === "not_due") return "due";
  if (current.state === "sent" && current.stage !== report.stage) return "due";
  return current.state;
}

export interface DisputeStory {
  buyerFirstName: string;
  sellerFirstName: string;
  /** The disputed item's short name, such as chair, or null when the dispute covers the whole order. */
  noun: string | null;
  status: DisputeStatus;
  outcome: string | null;
  evidenceState: DisputeEvidenceState;
  /** What PayPal says the buyer got back, for a buyer win. */
  refundedCents: number | null;
  /** Roomover sent the buyer its one message while the dispute was an inquiry. */
  messageSent: boolean;
}

/** The status card's words: who opened what, and where it stands now. */
export function disputeWords(story: DisputeStory): { title: string; detail: string } {
  const about = story.noun === null ? "the order" : `the ${story.noun}`;
  const buyer = story.buyerFirstName;
  const seller = story.sellerFirstName;
  if (story.status === "resolved") {
    if (story.outcome === "RESOLVED_BUYER_FAVOUR") {
      const refunded = story.refundedCents === null ? "" : ` ${formatUsdShort(story.refundedCents)}`;
      return { title: `PayPal refunded ${buyer}${refunded} for ${about}.`, detail: `${seller} keeps the payout, and Roomover covers the refund.` };
    }
    if (story.outcome === "RESOLVED_SELLER_FAVOUR") return { title: `PayPal closed the dispute about ${about} in ${seller}'s favor.`, detail: "The payment stands, and nothing more is needed." };
    if (story.outcome === "CANCELED_BY_BUYER") return { title: `${buyer} closed the dispute about ${about}.`, detail: "The payment stands." };
    return { title: `PayPal resolved the dispute about ${about}.`, detail: "Nothing more is needed from Roomover." };
  }
  const title = `${buyer} opened a dispute about ${about}.`;
  const sent = "Roomover sent PayPal the photos and the handoff record.";
  switch (story.evidenceState) {
    case "sent":
      return { title, detail: story.status === "under_review" ? `${sent} PayPal is reviewing them.` : sent };
    case "due":
    case "sending":
      return { title, detail: "Roomover is sending PayPal the photos and the handoff record." };
    case "failed":
      return { title, detail: "PayPal did not take the evidence yet. Roomover sends it again when PayPal next updates the dispute." };
    case "not_due":
      if (story.messageSent) return { title, detail: `Roomover sent ${buyer} the facts from the handoff record in PayPal, and sends PayPal the photos and the record if the case is escalated.` };
      if (story.status === "waiting_for_buyer_response") return { title, detail: `PayPal is waiting for ${buyer}'s reply.` };
      if (story.status === "under_review") return { title, detail: "PayPal is reviewing it." };
      return { title, detail: "PayPal has not asked Roomover for evidence yet." };
  }
}
