import { z } from "zod";

/**
 * What the verifier assembles for a PayPal dispute. Notes follow the Disputes
 * API limit of 1 to 2000 characters.
 */
export const evidenceBundleSchema = z.strictObject({
  notes: z.string().min(1).max(2000),
  listingPhotos: z.array(z.string().min(1)),
  handoffPhotos: z.array(z.string().min(1)),
  comparisonSummary: z.string().min(1),
  timeline: z.array(z.strictObject({ at: z.iso.datetime({ offset: true }), event: z.string().min(1) })).min(1),
});

export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;
