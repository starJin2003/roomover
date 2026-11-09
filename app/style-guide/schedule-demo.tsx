import { connection } from "next/server";
import { ScheduleSection } from "@/components/schedule/schedule-section";
import type { HandoffMode } from "@/lib/domain/enums";
import { campusClock, campusInstant, slotFor } from "@/lib/domain/handoff-slots";
import { buildSchedule, type ScheduleItem, type ScheduleView } from "@/lib/domain/schedule";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Harbor Hall 214's five sellers on the seed calendar, counted from today so every drag lands in the future. */
async function demoSchedule(): Promise<ScheduleView> {
  await connection();
  const today = Date.now();
  const day = (offset: number) => campusClock(new Date(today + offset * DAY_MS)).day;
  const at = (offset: number, hour: number) => campusInstant(day(offset), hour);
  const window = (from: [number, number], to: [number, number]) => ({ startsAt: at(...from), endsAt: at(...to) });
  const moveIn = window([14, 9], [16, 18]);
  const fallMoveOut = window([6, 8], [7, 12]);
  const item = (id: string, seller: string, noun: string, mode: HandoffMode, moveOut: ReturnType<typeof window>, slotDay: number, hour: number): ScheduleItem => ({
    orderItemId: id,
    sellerId: id,
    sellerName: seller,
    noun,
    handoffMode: mode,
    moveOut,
    moveIn,
    slot: slotFor({ day: day(slotDay), startHour: hour }),
    waiting: true,
  });
  return buildSchedule({
    buyerFirstName: "Jordan",
    roomLabel: "Harbor Hall 214",
    open: true,
    holdEndsAt: new Date(today + 29 * DAY_MS),
    items: [
      item("jun", "Jun Park", "desk", "direct", window([7, 9], [16, 20]), 14, 14),
      item("marcus", "Marcus Bell", "chair", "direct", window([10, 10], [20, 20]), 15, 16),
      item("ava", "Ava Lindqvist", "lamp", "direct", window([9, 9], [17, 20]), 14, 12),
      item("sofia", "Sofia Navarro", "clamp lamp", "same_room", fallMoveOut, 14, 10),
      item("lea", "Lea Moreau", "bean bag", "same_room", fallMoveOut, 15, 12),
    ],
  });
}

export async function ScheduleDemo() {
  return <ScheduleSection schedule={await demoSchedule()} />;
}
