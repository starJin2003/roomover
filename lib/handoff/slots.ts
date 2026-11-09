import { and, eq, inArray, isNull } from "drizzle-orm";
import { publish } from "@/lib/agents/bus";
import type { Database } from "@/lib/db/client";
import { insertHandoffEvents, loadHandoffOrder, type HandoffOrder } from "@/lib/db/handoffs";
import { handoffs, orders } from "@/lib/db/schema";
import { formatSlot } from "@/lib/domain/handoff-slots";
import { canCheck } from "@/lib/domain/order-state";
import { checkSlotMove } from "@/lib/domain/schedule";
import { HandoffRefused } from "./check";
import { scheduleOf, type ScheduleWords } from "./schedule";

export interface SlotMove {
  planId: string;
  orderItemIds: readonly string[];
  startsAt: Date;
}

/**
 * Moves one agreed handoff slot, for every item it covers, and writes the
 * sentence the panel shows. The order row stays locked while the move is
 * checked and saved, so a settlement or a release cannot start in between.
 * Moving a slot changes no amount and calls no PayPal API.
 */
export async function moveSlot(
  deps: { db: Database; now: () => Date },
  move: SlotMove,
  words: (order: HandoffOrder) => ScheduleWords,
): Promise<{ sentence: string }> {
  const result = await deps.db.transaction(async (tx) => {
    const found = await loadHandoffOrder(tx, move.planId);
    if (found === null) throw new HandoffRefused(404, "This room has no paid order to hand off.");
    await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, found.id)).for("update");
    const order = (await loadHandoffOrder(tx, move.planId)) as HandoffOrder;
    if (!canCheck(order.status)) throw new HandoffRefused(409, "This handoff is finished, so its slots stay as they are.");
    const context = words(order);
    const schedule = scheduleOf(order, context);
    const wanted = new Set(move.orderItemIds);
    const slot = schedule.slots.find((candidate) => candidate.orderItemIds.length === wanted.size && candidate.orderItemIds.every((id) => wanted.has(id)));
    if (slot === undefined) throw new HandoffRefused(404, "That handoff is not part of this room.");
    const check = checkSlotMove(slot, move.startsAt, { now: deps.now(), buyerFirstName: context.buyerFirstName });
    if (!check.ok) throw new HandoffRefused(422, check.sentence);
    if (check.slot.startsAt.getTime() === new Date(slot.startsAt).getTime()) return { sentence: `${slot.sellerFirstName}'s handoff stays ${formatSlot(check.slot)}.`, moved: false };
    await tx
      .update(handoffs)
      .set({ slotStartsAt: check.slot.startsAt, slotEndsAt: check.slot.endsAt })
      .where(and(inArray(handoffs.orderItemId, slot.orderItemIds), isNull(handoffs.decision)));
    await insertHandoffEvents(tx, order, "platform", [
      {
        tool: "move_slot",
        summary: `Moved ${slot.sellerFirstName}'s handoff for the ${slot.nouns} from ${slot.label} to ${formatSlot(check.slot)}, as ${context.buyerFirstName} asked. No payment changed.`,
        sentence: check.sentence,
      },
    ]);
    return { sentence: check.sentence, moved: true };
  });
  if (result.moved) publish(move.planId, { type: "handoff" });
  return { sentence: result.sentence };
}
