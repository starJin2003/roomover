import type { TimeWindow } from "./handoff";

/**
 * Handoff slots the buyer and seller agents agree on. A slot is two hours
 * that start on the hour at 10 AM, noon, 2 PM, 4 PM, or 6 PM campus time,
 * and it must sit inside every window it serves: the item's handoff window
 * (the seller's move out overlapping the buyer's move in) and, for a
 * bundle, each item's window.
 */

export const CAMPUS_TIME_ZONE = "America/Chicago";
export const SLOT_HOURS = 2;
export const SLOT_START_HOURS = [10, 12, 14, 16, 18] as const;

const HOUR_MS = 60 * 60 * 1000;
const CAMPUS_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A slot a student can show up for, as code names it: a campus day and the hour it starts. */
export interface SlotChoice {
  day: string;
  startHour: number;
}

/**
 * A slot as the agents name it: which day of the handoff window, counting
 * from 1, and the hour it starts. Seed windows move with each reseed, so a
 * recorded agent conversation stays valid on any later day.
 */
export interface WindowSlot {
  windowDay: number;
  startHour: number;
}

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: CAMPUS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const offsetFormat = new Intl.DateTimeFormat("en-US", { timeZone: CAMPUS_TIME_ZONE, timeZoneName: "longOffset" });
const weekdayFormat = new Intl.DateTimeFormat("en-US", { timeZone: CAMPUS_TIME_ZONE, weekday: "short", month: "short", day: "numeric" });

function campusOffsetMs(instant: Date): number {
  const name = offsetFormat.formatToParts(instant).find((part) => part.type === "timeZoneName")?.value ?? "";
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
  if (match === null) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return (match[1] === "-" ? -minutes : minutes) * 60_000;
}

/** The campus wall clock at an instant. */
export function campusClock(instant: Date): { day: string; hour: number; minute: number } {
  const parts = Object.fromEntries(partsFormat.formatToParts(instant).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

/** The instant of a campus wall clock hour, across daylight saving changes. */
export function campusInstant(day: string, hour: number): Date {
  const match = CAMPUS_DAY.exec(day);
  if (match === null) throw new RangeError(`Expected a campus day as YYYY-MM-DD, got ${day}.`);
  const wallClockAsUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, 0);
  const firstGuess = wallClockAsUtc - campusOffsetMs(new Date(wallClockAsUtc));
  return new Date(wallClockAsUtc - campusOffsetMs(new Date(firstGuess)));
}

export function slotFor(choice: SlotChoice): TimeWindow {
  const startsAt = campusInstant(choice.day, choice.startHour);
  return { startsAt, endsAt: new Date(startsAt.getTime() + SLOT_HOURS * HOUR_MS) };
}

export function slotChoiceOf(slot: TimeWindow): SlotChoice {
  const { day, hour } = campusClock(slot.startsAt);
  return { day, startHour: hour };
}

/** True for two hours that start on one of the slot hours, on the hour. */
export function isSlotShape(slot: TimeWindow): boolean {
  const { hour, minute } = campusClock(slot.startsAt);
  return (
    minute === 0 &&
    slot.startsAt.getUTCSeconds() === 0 &&
    (SLOT_START_HOURS as readonly number[]).includes(hour) &&
    slot.endsAt.getTime() - slot.startsAt.getTime() === SLOT_HOURS * HOUR_MS
  );
}

export const slotInside = (slot: TimeWindow, window: TimeWindow): boolean => slot.startsAt >= window.startsAt && slot.endsAt <= window.endsAt;

/** The time every window shares, or null when they share none. */
export function overlapOf(windows: readonly TimeWindow[]): TimeWindow | null {
  if (windows.length === 0) return null;
  const startsAt = new Date(Math.max(...windows.map((window) => window.startsAt.getTime())));
  const endsAt = new Date(Math.min(...windows.map((window) => window.endsAt.getTime())));
  return startsAt < endsAt ? { startsAt, endsAt } : null;
}

/** Every slot inside a window, earliest first, capped so a long storage window stays a short list. */
export function slotsInside(window: TimeWindow, limit = 40): TimeWindow[] {
  const slots: TimeWindow[] = [];
  const first = campusClock(window.startsAt).day;
  for (let offset = 0; slots.length < limit; offset++) {
    const day = shiftDay(first, offset);
    if (campusInstant(day, 0) > window.endsAt) break;
    for (const startHour of SLOT_START_HOURS) {
      const slot = slotFor({ day, startHour });
      if (slotInside(slot, window)) slots.push(slot);
      if (slots.length === limit) break;
    }
  }
  return slots;
}

function shiftDay(day: string, days: number): string {
  const match = CAMPUS_DAY.exec(day);
  if (match === null) throw new RangeError(`Expected a campus day as YYYY-MM-DD, got ${day}.`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}

function hourWords(hour: number): { value: string; meridiem: "AM" | "PM" } {
  const meridiem = hour < 12 || hour === 24 ? "AM" : "PM";
  const value = hour % 12 === 0 ? "12" : String(hour % 12);
  return { value, meridiem };
}

/** "Mon Nov 23, 2 to 4 PM", or "Mon Nov 23, 10 AM to 12 PM" when the slot crosses noon. */
export function formatSlot(slot: TimeWindow): string {
  const day = weekdayFormat.format(slot.startsAt).replace(",", "");
  const from = hourWords(campusClock(slot.startsAt).hour);
  const to = hourWords(campusClock(slot.endsAt).hour);
  const range = from.meridiem === to.meridiem ? `${from.value} to ${to.value} ${to.meridiem}` : `${from.value} ${from.meridiem} to ${to.value} ${to.meridiem}`;
  return `${day}, ${range}`;
}

/** A window as the agents read it, in campus wall clock time, such as 2026-11-23 09:00. */
export function windowForAgent(window: TimeWindow): { from: string; to: string } {
  const show = (instant: Date) => {
    const { day, hour, minute } = campusClock(instant);
    return `${day} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  };
  return { from: show(window.startsAt), to: show(window.endsAt) };
}

/** The campus days a window touches, numbered from 1 for the agents. */
export function windowDays(window: TimeWindow): { windowDay: number; date: string; day: string }[] {
  const first = campusClock(window.startsAt).day;
  const last = campusClock(window.endsAt).day;
  const days: { windowDay: number; date: string; day: string }[] = [];
  for (let offset = 0; offset < 400; offset++) {
    const day = shiftDay(first, offset);
    days.push({ windowDay: offset + 1, day, date: weekdayFormat.format(campusInstant(day, 12)).replace(",", "") });
    if (day === last) break;
  }
  return days;
}

/** The slot an agent names, or null when the day falls outside the window. Code still checks the slot fits. */
export function slotFromWindow(window: TimeWindow, choice: WindowSlot): TimeWindow | null {
  if (!Number.isInteger(choice.windowDay) || choice.windowDay < 1 || choice.windowDay > 400) return null;
  const day = shiftDay(campusClock(window.startsAt).day, choice.windowDay - 1);
  if (campusInstant(day, 0) > window.endsAt) return null;
  return slotFor({ day, startHour: choice.startHour });
}

/** The window day and hour of a slot, the way the agents name it. */
export function windowSlotOf(window: TimeWindow, slot: TimeWindow): WindowSlot {
  const first = campusClock(window.startsAt).day;
  const { day, hour } = campusClock(slot.startsAt);
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
  return { windowDay: days + 1, startHour: hour };
}
