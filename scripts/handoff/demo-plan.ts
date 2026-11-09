import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { plans, roomPresets } from "@/lib/db/schema";
import { DEMO_BUYER_ID, DEMO_ROOM } from "@/lib/demo";
import { HARBOR_214_DEMO_LAYOUT } from "../seed/layouts";

/**
 * A ready plan for Jordan's Harbor Hall 214 holding the five seller demo
 * cart (Jun's desk, Marcus's mesh desk chair, Ava's lamp, Sofia's clamp
 * lamp, and Lea's bean bag), so a handoff test or a recorded run starts at
 * checkout without a buyer agent run. The plan belongs to the session given.
 */
export async function createDemoPlan(db: Database, sessionId: string): Promise<string> {
  const [preset] = await db.select({ id: roomPresets.id }).from(roomPresets).where(eq(roomPresets.slug, DEMO_ROOM.presetSlug));
  if (preset === undefined) throw new Error("The demo room preset is missing. Run the seed first.");
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
  return plan.id;
}
