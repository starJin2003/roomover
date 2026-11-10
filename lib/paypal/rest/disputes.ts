import { z } from "zod";
import { DOCUMENT_NAME, EVIDENCE_LIMITS, MESSAGE_LIMIT, type EvidenceContentType } from "@/lib/domain/dispute";
import type { PayPalRestClient } from "@/lib/paypal/rest/client";

/**
 * The Disputes API over REST. The Server SDK 2.5.0 has no Disputes
 * controller, so fields and calls follow PayPal's customer_disputes_v1
 * OpenAPI spec 1.11.
 */

const moneySchema = z.object({ currency_code: z.string(), value: z.string() });
const linkSchema = z.object({ href: z.string(), rel: z.string(), method: z.string().optional() });

/** A dispute as GET returns it and as CUSTOMER.DISPUTE webhooks carry it. */
export const paypalDisputeSchema = z.object({
  dispute_id: z.string().min(1),
  reason: z.string().optional(),
  status: z.string().optional(),
  dispute_life_cycle_stage: z.string().optional(),
  dispute_channel: z.string().optional(),
  dispute_amount: moneySchema.optional(),
  dispute_outcome: z.object({ outcome_code: z.string().optional(), amount_refunded: moneySchema.optional() }).optional(),
  create_time: z.string().optional(),
  update_time: z.string().optional(),
  buyer_response_due_date: z.string().optional(),
  seller_response_due_date: z.string().optional(),
  disputed_transactions: z
    .array(
      z.object({
        seller_transaction_id: z.string().optional(),
        buyer_transaction_id: z.string().optional(),
        custom: z.string().optional(),
        invoice_number: z.string().optional(),
        /** The order's items the buyer picked, with `item_id` carrying the item's sku, which Roomover sets to the listing ID. */
        items: z.array(z.object({ item_id: z.string().optional(), item_name: z.string().optional() })).optional(),
      }),
    )
    .optional(),
  evidences: z.array(z.object({ evidence_type: z.string().optional(), source: z.string().optional(), dispute_life_cycle_stage: z.string().optional() })).optional(),
  links: z.array(linkSchema).optional(),
});

export type PayPalDispute = z.infer<typeof paypalDisputeSchema>;

export function getDispute(rest: PayPalRestClient, disputeId: string): Promise<PayPalDispute> {
  return rest.request({
    method: "GET",
    path: `/v1/customer/disputes/${encodeURIComponent(disputeId)}`,
    schema: paypalDisputeSchema,
  });
}

export interface EvidenceFile {
  /** Letters, digits, spaces, hyphens, underscores, or commas, then one extension. */
  readonly filename: string;
  readonly contentType: EvidenceContentType;
  readonly data: Uint8Array<ArrayBuffer>;
}

export interface DisputeEvidence {
  /** Any type the spec lists. PROOF_OF_REFUND carries refund IDs, and the rest go with documents and notes. */
  readonly evidenceType: string;
  readonly notes: string;
  readonly files: readonly EvidenceFile[];
  readonly refundIds?: readonly string[];
}

function assertEvidence(evidence: DisputeEvidence): void {
  if (evidence.notes.length < 1 || evidence.notes.length > EVIDENCE_LIMITS.notes) {
    throw new RangeError(`Dispute evidence notes must be 1 to ${EVIDENCE_LIMITS.notes} characters.`);
  }
  if (evidence.evidenceType === "PROOF_OF_REFUND" && (evidence.refundIds ?? []).length === 0) throw new RangeError("PROOF_OF_REFUND needs at least one refund ID.");
  let total = 0;
  for (const file of evidence.files) {
    if (!DOCUMENT_NAME.test(file.filename)) {
      throw new RangeError(`Evidence file name "${file.filename}" is not accepted by PayPal.`);
    }
    if (file.data.byteLength >= EVIDENCE_LIMITS.fileBytes) {
      throw new RangeError(`Evidence file "${file.filename}" must be under 10 MB.`);
    }
    total += file.data.byteLength;
  }
  if (total > EVIDENCE_LIMITS.requestBytes) throw new RangeError("Evidence files must total at most 50 MB per call.");
}

/**
 * Sends evidence as multipart/form-data with the JSON in a part named input
 * and each file in an evidence-file part named after its document. PayPal
 * accepts this only while the dispute waits for the seller and carries a
 * provide-evidence link. The API takes no PayPal-Request-Id, so the caller's
 * dispute state machine must keep a submission from being sent twice.
 */
export function provideDisputeEvidence(rest: PayPalRestClient, disputeId: string, evidence: DisputeEvidence): Promise<{ links: z.infer<typeof linkSchema>[] }> {
  assertEvidence(evidence);
  const payload = {
    evidences: [
      {
        evidence_type: evidence.evidenceType,
        notes: evidence.notes,
        documents: evidence.files.map((file) => ({ name: file.filename })),
        ...(evidence.evidenceType === "PROOF_OF_REFUND" ? { evidence_info: { refund_ids: evidence.refundIds } } : {}),
      },
    ],
  };

  const form = new FormData();
  form.append("input", new Blob([JSON.stringify(payload)], { type: "application/json" }));
  for (const file of evidence.files) {
    form.append("evidence-file", new Blob([file.data], { type: file.contentType }), file.filename);
  }

  return rest.request({
    method: "POST",
    path: `/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`,
    body: { kind: "multipart", form },
    schema: z.object({ links: z.array(linkSchema).default([]) }),
  });
}

/**
 * Sends the other party a message on a dispute. PayPal takes it only while
 * the dispute is an inquiry and carries a send-message link, with the text in
 * a JSON body. Like provide-evidence, the call takes no PayPal-Request-Id, so
 * the caller's dispute row keeps a message from going twice.
 */
export function sendDisputeMessage(rest: PayPalRestClient, disputeId: string, message: string): Promise<{ links: z.infer<typeof linkSchema>[] }> {
  if (message.trim().length === 0 || message.length > MESSAGE_LIMIT) throw new RangeError(`A dispute message must be 1 to ${MESSAGE_LIMIT} characters.`);
  return rest.request({
    method: "POST",
    path: `/v1/customer/disputes/${encodeURIComponent(disputeId)}/send-message`,
    body: { kind: "json", value: { message } },
    schema: z.object({ links: z.array(linkSchema).default([]) }),
  });
}

/** Sandbox only. Moves a dispute under review back to waiting for one party's evidence. */
export function requireDisputeEvidence(rest: PayPalRestClient, disputeId: string, action: "BUYER_EVIDENCE" | "SELLER_EVIDENCE"): Promise<{ links: z.infer<typeof linkSchema>[] }> {
  return rest.request({
    method: "POST",
    path: `/v1/customer/disputes/${encodeURIComponent(disputeId)}/require-evidence`,
    body: { kind: "json", value: { action } },
    schema: z.object({ links: z.array(linkSchema).default([]) }),
  });
}

/** Sandbox only. Settles a dispute under review for the buyer or the seller, as a PayPal agent would. */
export function adjudicateDispute(rest: PayPalRestClient, disputeId: string, outcome: "BUYER_FAVOR" | "SELLER_FAVOR"): Promise<{ links: z.infer<typeof linkSchema>[] }> {
  return rest.request({
    method: "POST",
    path: `/v1/customer/disputes/${encodeURIComponent(disputeId)}/adjudicate`,
    body: { kind: "json", value: { adjudication_outcome: outcome } },
    schema: z.object({ links: z.array(linkSchema).default([]) }),
  });
}
