import { PRESET_SLUGS } from "@/scripts/seed/campus";
import { userId } from "@/scripts/seed/people";

/**
 * The seeded judge buyer every demo session acts as, and the room Jordan
 * moves into. Seed IDs are name based, so these match the database.
 */
export const DEMO_BUYER_ID = userId("jordan");
export const DEMO_ROOM = { presetSlug: PRESET_SLUGS.harborDouble, roomNumber: "214" } as const;
