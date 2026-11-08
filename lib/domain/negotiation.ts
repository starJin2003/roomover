import { z } from "zod";

/** One structured message between the buyer agent and a seller agent. */
export const offerSchema = z.strictObject({
  round: z.number().int().positive(),
  from: z.enum(["buyer", "seller"]),
  action: z.enum(["offer", "counter", "accept", "decline"]),
  priceCents: z.number().int().positive().optional(),
  handoffSlot: z
    .strictObject({ startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }) })
    .refine((slot) => Date.parse(slot.endsAt) > Date.parse(slot.startsAt), "A slot must end after it starts.")
    .optional(),
  bundleListingIds: z.array(z.uuid()).min(1).optional(),
  message: z.string().min(1),
  at: z.iso.datetime({ offset: true }),
});

export const offersLogSchema = z.array(offerSchema);

export type Offer = z.infer<typeof offerSchema>;
export type OffersLog = z.infer<typeof offersLogSchema>;
