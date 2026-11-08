import { z } from "zod";
import type { PayPalRestClient } from "@/lib/paypal/rest/client";

const moneySchema = z.object({ currency_code: z.string(), value: z.string() });
const linkSchema = z.object({ href: z.string(), rel: z.string(), method: z.string().optional() });

const disputeSchema = z.object({
  dispute_id: z.string(),
  reason: z.string(),
  status: z.string(),
  dispute_life_cycle_stage: z.string().optional(),
  dispute_channel: z.string().optional(),
  dispute_amount: moneySchema.optional(),
  dispute_outcome: z
    .object({ outcome_code: z.string().optional(), amount_refunded: moneySchema.optional() })
    .optional(),
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
      }),
    )
    .optional(),
  links: z.array(linkSchema).optional(),
});

export type PayPalDispute = z.infer<typeof disputeSchema>;

export function getDispute(rest: PayPalRestClient, disputeId: string): Promise<PayPalDispute> {
  return rest.request({
    method: "GET",
    path: `/v1/customer/disputes/${encodeURIComponent(disputeId)}`,
    schema: disputeSchema,
  });
}

export interface EvidenceFile {
  /** Letters, digits, spaces, hyphens, underscores, or commas, then one extension. */
  readonly filename: string;
  readonly contentType: "image/jpeg" | "image/png" | "image/gif" | "application/pdf";
  readonly data: Uint8Array<ArrayBuffer>;
}

/** Handoff photos and the comparison report go in as ITEM_DESCRIPTION. A partial refund is PROOF_OF_REFUND. */
export type DisputeEvidence =
  | { readonly evidenceType: "ITEM_DESCRIPTION" | "OTHER"; readonly notes: string; readonly files: readonly EvidenceFile[] }
  | {
      readonly evidenceType: "PROOF_OF_REFUND";
      readonly refundIds: readonly string[];
      readonly notes: string;
      readonly files: readonly EvidenceFile[];
    };

const DOCUMENT_NAME = /^[A-Za-z0-9\-_,\s]+\.[A-Za-z]+$/;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_CALL_BYTES = 50 * 1024 * 1024;

function assertEvidence(evidence: DisputeEvidence): void {
  if (evidence.notes.length < 1 || evidence.notes.length > 2000) {
    throw new RangeError("Dispute evidence notes must be 1 to 2000 characters.");
  }
  let total = 0;
  for (const file of evidence.files) {
    if (!DOCUMENT_NAME.test(file.filename)) {
      throw new RangeError(`Evidence file name "${file.filename}" is not accepted by PayPal.`);
    }
    if (file.data.byteLength >= MAX_FILE_BYTES) {
      throw new RangeError(`Evidence file "${file.filename}" must be under 10 MB.`);
    }
    total += file.data.byteLength;
  }
  if (total > MAX_CALL_BYTES) throw new RangeError("Evidence files must total at most 50 MB per call.");
}

/**
 * Sends evidence as multipart/form-data with the JSON in a part named input
 * and each file in an evidence-file part named after its document. PayPal
 * accepts this only while the dispute waits for the seller and carries a
 * provide-evidence link. The API takes no PayPal-Request-Id, so the caller's
 * dispute state machine must keep a submission from being sent twice.
 */
export function provideDisputeEvidence(
  rest: PayPalRestClient,
  disputeId: string,
  evidence: DisputeEvidence,
): Promise<{ links: z.infer<typeof linkSchema>[] }> {
  assertEvidence(evidence);
  const payload = {
    evidences: [
      {
        evidence_type: evidence.evidenceType,
        notes: evidence.notes,
        documents: evidence.files.map((file) => ({ name: file.filename })),
        ...(evidence.evidenceType === "PROOF_OF_REFUND"
          ? { evidence_info: { refund_ids: evidence.refundIds } }
          : {}),
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
