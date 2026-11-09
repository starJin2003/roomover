import { eq, sql } from "drizzle-orm";
import { CAMPUS } from "@/scripts/seed/campus";
import type { Database } from "./client";
import { halls, roomPresets, users } from "./schema";

export interface SellerProfile {
  id: string;
  displayName: string;
  /** The payer ID from Log in with PayPal. */
  paypalAccountId: string | null;
  /** The room the seller lives in, which a same room handoff leaves the item in. */
  room: { presetId: string; number: string; label: string } | null;
}

export type SellerLink = { ok: true; userId: string; created: boolean } | { ok: false; reason: "platform" | "no_account" };

/**
 * Finds or creates the user a Log in with PayPal account belongs to. A payer
 * ID finds a seller who logged in before, the email finds a seeded seller
 * logging in for the first time, and anyone else becomes a new Lakeshore
 * seller. A payer ID PayPal sends is stored on the user, so later payouts go
 * to it. Without one, payouts go to the account's email, which the sandbox
 * shares (its userinfo leaves the payer ID out, see status). An answer with
 * neither leaves nothing to pay, so it is refused.
 */
export async function linkPayPalSeller(db: Database, input: { payerId: string | null; email: string | null; name: string | null }): Promise<SellerLink> {
  if (input.payerId === null && input.email === null) return { ok: false, reason: "no_account" };
  return db.transaction(async (tx) => {
    if (input.payerId !== null) {
      const [byPayer] = await tx.select({ id: users.id, role: users.role }).from(users).where(eq(users.paypalAccountId, input.payerId)).for("update");
      if (byPayer !== undefined) return byPayer.role === "platform" ? refusedPlatform() : { ok: true, userId: byPayer.id, created: false };
    }

    if (input.email !== null) {
      const [byEmail] = await tx.select({ id: users.id, role: users.role }).from(users).where(sql`lower(${users.paypalEmail}) = ${input.email}`).for("update");
      if (byEmail !== undefined) {
        if (byEmail.role === "platform") return refusedPlatform();
        if (input.payerId !== null) await tx.update(users).set({ paypalAccountId: input.payerId }).where(eq(users.id, byEmail.id));
        return { ok: true, userId: byEmail.id, created: false };
      }
    }

    const [created] = await tx
      .insert(users)
      .values({ role: "seller", displayName: input.name ?? "Lakeshore seller", campus: CAMPUS, paypalAccountId: input.payerId, paypalEmail: input.email, payoutWallet: "paypal" })
      .returning({ id: users.id });
    return { ok: true, userId: created.id, created: true };
  });
}

/** The platform account receives buyers' payments and funds payouts, so it never sells. */
function refusedPlatform(): SellerLink {
  return { ok: false, reason: "platform" };
}

export async function loadSeller(db: Database, userId: string): Promise<SellerProfile | null> {
  const [row] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      paypalAccountId: users.paypalAccountId,
      presetId: users.roomPresetId,
      roomNumber: users.roomNumber,
      hallName: halls.name,
    })
    .from(users)
    .leftJoin(roomPresets, eq(users.roomPresetId, roomPresets.id))
    .leftJoin(halls, eq(roomPresets.hallId, halls.id))
    .where(eq(users.id, userId));
  if (row === undefined) return null;
  const room = row.presetId !== null && row.roomNumber !== null && row.hallName !== null ? { presetId: row.presetId, number: row.roomNumber, label: `${row.hallName} ${row.roomNumber}` } : null;
  return { id: row.id, displayName: row.displayName, paypalAccountId: row.paypalAccountId, room };
}
