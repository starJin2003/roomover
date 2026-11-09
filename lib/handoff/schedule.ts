import type { HandoffOrder } from "@/lib/db/handoffs";
import { AUTHORIZATION_VALIDITY_DAYS } from "@/lib/domain/handoff";
import { canCheck } from "@/lib/domain/order-state";
import { buildSchedule, type ScheduleView } from "@/lib/domain/schedule";

const DAY_MS = 24 * 60 * 60 * 1000;

/** When PayPal's hold on an authorize mode order ends, so every capture has to happen before it. */
function holdEndsAt(order: HandoffOrder): Date | null {
  if (order.paymentMode !== "authorize_then_capture") return null;
  if (order.authorizationExpiresAt !== null) return order.authorizationExpiresAt;
  return order.approvedAt === null ? null : new Date(order.approvedAt.getTime() + AUTHORIZATION_VALIDITY_DAYS * DAY_MS);
}

/** The schedule of one order, with each item's noun from the room and its rows in checklist order. */
export interface ScheduleWords {
  /** Each order item's short noun, such as desk. */
  nouns: ReadonlyMap<string, string>;
  /** Order item IDs in checklist order. */
  order: readonly string[];
  buyerFirstName: string;
  roomLabel: string;
}

export function scheduleOf(order: HandoffOrder, words: ScheduleWords): ScheduleView {
  const placed = (orderItemId: string) => {
    const index = words.order.indexOf(orderItemId);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const items = [...order.items]
    .filter((item) => item.handoff !== null)
    .sort((a, b) => placed(a.orderItemId) - placed(b.orderItemId))
    .map((item) => {
      const handoff = item.handoff as NonNullable<typeof item.handoff>;
      return {
        orderItemId: item.orderItemId,
        sellerId: item.sellerId,
        sellerName: item.sellerName,
        noun: words.nouns.get(item.orderItemId) ?? item.title.toLowerCase(),
        handoffMode: item.handoffMode,
        moveOut: { startsAt: item.moveOutStartsAt, endsAt: item.moveOutEndsAt },
        moveIn: { startsAt: item.moveInStartsAt, endsAt: item.moveInEndsAt },
        slot: { startsAt: handoff.slotStartsAt, endsAt: handoff.slotEndsAt },
        waiting: handoff.decision === null && handoff.photos.length === 0,
      };
    });
  return buildSchedule({ buyerFirstName: words.buyerFirstName, roomLabel: words.roomLabel, open: canCheck(order.status), holdEndsAt: holdEndsAt(order), items });
}
