import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { saveNegotiations } from "@/lib/db/negotiations";
import { listings, plans, roomPresets } from "@/lib/db/schema";
import { DEMO_BUYER_ID, DEMO_ROOM } from "@/lib/demo";
import { handoffWindow, type TimeWindow } from "@/lib/domain/handoff";
import { formatSlot, slotFromWindow, slotInside, slotsInside, type WindowSlot } from "@/lib/domain/handoff-slots";
import { HARBOR_214_DEMO_LAYOUT } from "../seed/layouts";

/** The slot each seller settles on, counted in days of the item's handoff window, so the schedule shows five different handoffs. */
const DEMO_SLOTS: Readonly<Record<string, WindowSlot>> = {
  "jun-white-desk": { windowDay: 1, startHour: 14 },
  "marcus-mesh-desk-chair": { windowDay: 2, startHour: 16 },
  "ava-desk-lamp": { windowDay: 1, startHour: 12 },
  "sofia-clamp-lamp": { windowDay: 1, startHour: 10 },
  "lea-navy-bean-bag": { windowDay: 2, startHour: 12 },
};

const usd = (cents: number) => `$${cents / 100}`;

/**
 * A ready plan for Jordan's Harbor Hall 214 holding the five seller demo
 * cart (Jun's desk, Marcus's mesh desk chair, Ava's lamp, Sofia's clamp
 * lamp, and Lea's bean bag), so a handoff test or a recorded run starts at
 * checkout without a buyer agent run. Each item carries an agreed handoff
 * slot at its asking price, as a negotiated plan does, so checkout writes
 * the slots to the order and the Handoff schedule has slots to move. The
 * plan belongs to the session given.
 */
export async function createDemoPlan(db: Database, sessionId: string): Promise<string> {
  const [preset] = await db.select({ id: roomPresets.id }).from(roomPresets).where(eq(roomPresets.slug, DEMO_ROOM.presetSlug));
  if (preset === undefined) throw new Error("The demo room preset is missing. Run the seed first.");
  const listingIds = HARBOR_214_DEMO_LAYOUT.items.flatMap((item) => (item.source === "listing" ? [item.listingId] : []));
  const rows = await db
    .select({
      id: listings.id,
      priceCents: listings.priceCents,
      handoffMode: listings.handoffMode,
      moveOutStartsAt: listings.moveOutStartsAt,
      moveOutEndsAt: listings.moveOutEndsAt,
      moveInStartsAt: listings.moveInStartsAt,
      moveInEndsAt: listings.moveInEndsAt,
    })
    .from(listings)
    .where(inArray(listings.id, listingIds));
  const [plan] = await db
    .insert(plans)
    .values({
      buyerId: DEMO_BUYER_ID,
      sessionId,
      roomPresetId: preset.id,
      roomNumber: DEMO_ROOM.roomNumber,
      budgetCents: 15_000,
      stylePrompt: "$150, cozy, I study late",
      layout: HARBOR_214_DEMO_LAYOUT,
      status: "ready",
    })
    .returning({ id: plans.id });

  const at = new Date().toISOString();
  const agreed = HARBOR_214_DEMO_LAYOUT.items.flatMap((item) => {
    if (item.source !== "listing") return [];
    const listing = rows.find((row) => row.id === item.listingId);
    const window = listing === undefined ? null : handoffWindow(listing.handoffMode, listing);
    if (listing === undefined || window === null) return [];
    const slot = slotFor(window, DEMO_SLOTS[item.key]);
    if (slot === null) return [];
    const handoffSlot = { startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() };
    const words = `${usd(listing.priceCents)} with handoff ${formatSlot(slot)}`;
    return [
      {
        listingId: listing.id,
        status: "agreed" as const,
        offers: [
          { round: 1, from: "buyer" as const, action: "offer" as const, priceCents: listing.priceCents, handoffSlot, message: `Demo plan offer of ${words}.`, at },
          { round: 1, from: "seller" as const, action: "accept" as const, priceCents: listing.priceCents, handoffSlot, message: `Demo plan agreement at ${words}.`, at },
        ],
        agreedPriceCents: listing.priceCents,
        agreedSlot: slot,
      },
    ];
  });
  await saveNegotiations(db, plan.id, agreed);
  return plan.id;
}

/** The demo slot inside the window, or the window's first slot when the seed calendar moved it out. */
function slotFor(window: TimeWindow, choice: WindowSlot | undefined): TimeWindow | null {
  const wanted = choice === undefined ? null : slotFromWindow(window, choice);
  if (wanted !== null && slotInside(wanted, window) && wanted.startsAt > new Date()) return wanted;
  return slotsInside(window).find((slot) => slot.startsAt > new Date()) ?? null;
}
