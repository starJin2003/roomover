import type { HandoffMode } from "./enums";
import type { TimeWindow } from "./handoff";
import { campusClock, campusInstant, formatCampusDay, formatMoment, formatSlot, isSlotShape, overlapOf, SLOT_HOURS } from "./handoff-slots";

/**
 * The Handoff schedule: one row per seller and one for the student, each
 * seller's move out, the student's move in, the time an item waits in
 * storage or in the room, and the handoff slot each pair of agents agreed
 * on. Every time is an instant, and the screen draws it in campus time.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const STUDENT_ROW = "student";

export interface ScheduleItem {
  orderItemId: string;
  sellerId: string;
  sellerName: string;
  noun: string;
  handoffMode: HandoffMode;
  moveOut: TimeWindow;
  moveIn: TimeWindow;
  /** The handoff row's slot, which is the item's whole handoff window when no slot was agreed. */
  slot: TimeWindow;
  /** No photo and no decision yet, so the handoff has not started. */
  waiting: boolean;
}

export interface ScheduleInput {
  buyerFirstName: string;
  roomLabel: string;
  /** The order is still being checked, so waiting items can move. */
  open: boolean;
  /** When PayPal's authorization ends in authorize mode. Every handoff has to end by then. */
  holdEndsAt: Date | null;
  /** In checklist order, which orders the seller rows. */
  items: readonly ScheduleItem[];
}

export interface ScheduleWindow {
  startsAt: string;
  endsAt: string;
}

export type ScheduleRangeKind = "move_out" | "move_in" | "storage" | "room";

export interface ScheduleResource {
  id: string;
  kind: "seller" | "student";
  name: string;
  /** The items, or what the row shows, such as "desk and chair" or "moves in". */
  detail: string;
}

export interface ScheduleRange extends ScheduleWindow {
  id: string;
  resourceId: string;
  kind: ScheduleRangeKind;
  label: string;
}

/** What a slot has to stay inside. */
export interface SlotLimits {
  moveIn: ScheduleWindow;
  /** The seller's move out, for a direct handoff only. A stored or same room item waits for the student. */
  moveOut: ScheduleWindow | null;
  holdEndsAt: string | null;
}

export interface ScheduleSlot extends ScheduleWindow {
  id: string;
  resourceId: string;
  orderItemIds: string[];
  sellerFirstName: string;
  nouns: string;
  label: string;
  /** Two hours the agents agreed on. Without one, the slot is the item's whole handoff window. */
  agreed: boolean;
  movable: boolean;
  limits: SlotLimits | null;
}

export interface ScheduleView {
  buyerFirstName: string;
  resources: ScheduleResource[];
  ranges: ScheduleRange[];
  slots: ScheduleSlot[];
  /** Whole campus days from the first move out to the last window. */
  span: ScheduleWindow;
  /** The student's move in when every item shares one, drawn as a band across every row. */
  moveIn: ScheduleWindow | null;
  /** The gap in one sentence, with names and dates. */
  summary: string;
}

const iso = (window: TimeWindow): ScheduleWindow => ({ startsAt: window.startsAt.toISOString(), endsAt: window.endsAt.toISOString() });
const dates = (window: ScheduleWindow): TimeWindow => ({ startsAt: new Date(window.startsAt), endsAt: new Date(window.endsAt) });
const sameWindow = (a: TimeWindow, b: TimeWindow) => a.startsAt.getTime() === b.startsAt.getTime() && a.endsAt.getTime() === b.endsAt.getTime();
const firstNameOf = (name: string) => name.split(" ")[0];

function distinct(windows: readonly TimeWindow[]): TimeWindow[] {
  return windows.filter((window, index) => windows.findIndex((other) => sameWindow(other, window)) === index).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** "desk", "rug and chair", or "lamp, cart, and rug". */
export function listWords(words: readonly string[]): string {
  if (words.length <= 2) return words.join(" and ");
  return `${words.slice(0, -1).join(", ")}, and ${words.at(-1)}`;
}

/** Midnight in campus time at the start of the instant's campus day, or of the next day. */
function campusMidnight(instant: Date, next: boolean): Date {
  const { day } = campusClock(instant);
  const midnight = campusInstant(day, 0);
  if (!next || midnight.getTime() === instant.getTime()) return midnight;
  return campusInstant(campusClock(new Date(midnight.getTime() + DAY_MS + 2 * HOUR_MS)).day, 0);
}

function limitsFor(items: readonly ScheduleItem[], holdEndsAt: Date | null): SlotLimits | null {
  const moveIn = overlapOf(items.map((item) => item.moveIn));
  const direct = items.filter((item) => item.handoffMode === "direct");
  const moveOut = direct.length === 0 ? null : overlapOf(direct.map((item) => item.moveOut));
  if (moveIn === null || (direct.length > 0 && moveOut === null)) return null;
  return { moveIn: iso(moveIn), moveOut: moveOut === null ? null : iso(moveOut), holdEndsAt: holdEndsAt?.toISOString() ?? null };
}

function summaryOf(input: ScheduleInput, moveIn: TimeWindow | null): string {
  const waiting = input.items.filter((item) => item.handoffMode !== "direct");
  const arrives = moveIn === null ? "" : ` on ${formatCampusDay(moveIn.startsAt)}`;
  if (waiting.length === 0) return `Every seller is still on campus when ${input.buyerFirstName} arrives${arrives}, so each handoff happens in person.`;
  const names = [...new Set(waiting.map((item) => firstNameOf(item.sellerName)))];
  const leftBy = new Date(Math.max(...waiting.map((item) => item.moveOut.endsAt.getTime())));
  const arrival = moveIn?.startsAt ?? new Date(Math.min(...waiting.map((item) => item.moveIn.startsAt.getTime())));
  const days = Math.max(1, Math.round((arrival.getTime() - leftBy.getTime()) / DAY_MS));
  const place = waiting.every((item) => item.handoffMode === "storage_hold") ? "in campus storage" : waiting.every((item) => item.handoffMode === "same_room") ? `in ${input.roomLabel}` : "in the room or in storage";
  const verb = names.length === 1 ? "leaves" : "leave";
  return `${listWords(names)} ${verb} by ${formatCampusDay(leftBy)}, ${days} ${days === 1 ? "day" : "days"} before ${input.buyerFirstName} arrives, so Roomover keeps ${names.length === 1 ? "the item" : "their items"} ${place} until the handoff.`;
}

export function buildSchedule(input: ScheduleInput): ScheduleView {
  const sellers: ScheduleResource[] = [];
  const ranges: ScheduleRange[] = [];
  const slots: ScheduleSlot[] = [];

  for (const item of input.items) {
    if (sellers.some((seller) => seller.id === item.sellerId)) continue;
    const own = input.items.filter((other) => other.sellerId === item.sellerId);
    sellers.push({ id: item.sellerId, kind: "seller", name: item.sellerName, detail: listWords(own.map((other) => other.noun)) });
    distinct(own.map((other) => other.moveOut)).forEach((window, index) =>
      ranges.push({ id: `out-${item.sellerId}-${index}`, resourceId: item.sellerId, kind: "move_out", label: `${firstNameOf(item.sellerName)} moves out`, ...iso(window) }),
    );
  }

  // Items of one seller with one slot hand over together, as the agents agreed them in a bundle.
  const groups: ScheduleItem[][] = [];
  for (const item of input.items) {
    const group = groups.find((candidate) => candidate[0].sellerId === item.sellerId && sameWindow(candidate[0].slot, item.slot));
    if (group === undefined) groups.push([item]);
    else group.push(item);
  }
  for (const group of groups) {
    const [first] = group;
    const agreed = isSlotShape(first.slot);
    const limits = limitsFor(group, input.holdEndsAt);
    const id = `slot-${first.orderItemId}`;
    slots.push({
      id,
      resourceId: first.sellerId,
      orderItemIds: group.map((item) => item.orderItemId),
      sellerFirstName: firstNameOf(first.sellerName),
      nouns: listWords(group.map((item) => item.noun)),
      label: agreed ? formatSlot(first.slot) : `Any time ${formatMoment(first.slot.startsAt)} to ${formatMoment(first.slot.endsAt)}`,
      agreed,
      movable: input.open && agreed && limits !== null && group.every((item) => item.waiting),
      limits,
      ...iso(first.slot),
    });
    const held = group.filter((item) => item.handoffMode !== "direct");
    if (held.length > 0) {
      const from = new Date(Math.max(...held.map((item) => item.moveOut.endsAt.getTime())));
      if (from < first.slot.startsAt) {
        const storage = held.every((item) => item.handoffMode === "storage_hold");
        ranges.push({ id: `hold-${id}`, resourceId: first.sellerId, kind: storage ? "storage" : "room", label: storage ? "In campus storage" : `Waits in ${input.roomLabel}`, startsAt: from.toISOString(), endsAt: first.slot.startsAt.toISOString() });
      }
    }
  }

  const moveIns = distinct(input.items.map((item) => item.moveIn));
  moveIns.forEach((window, index) => ranges.push({ id: `in-${index}`, resourceId: STUDENT_ROW, kind: "move_in", label: `${input.buyerFirstName} moves in`, ...iso(window) }));

  const everything = [...ranges.map(dates), ...slots.map(dates)];
  const starts = everything.map((window) => window.startsAt.getTime());
  const ends = everything.map((window) => window.endsAt.getTime());
  const span = starts.length === 0 ? null : { startsAt: campusMidnight(new Date(Math.min(...starts)), false), endsAt: campusMidnight(new Date(Math.max(...ends)), true) };
  const moveIn = moveIns.length === 1 ? moveIns[0] : null;

  return {
    buyerFirstName: input.buyerFirstName,
    resources: [...sellers, { id: STUDENT_ROW, kind: "student", name: input.buyerFirstName, detail: "moves in" }],
    ranges,
    slots,
    span: span === null ? { startsAt: new Date(0).toISOString(), endsAt: new Date(DAY_MS).toISOString() } : iso(span),
    moveIn: moveIn === null ? null : iso(moveIn),
    summary: input.items.length === 0 ? "" : summaryOf(input, moveIn),
  };
}

export type SlotCheck = { ok: true; slot: TimeWindow; sentence: string } | { ok: false; sentence: string };

/**
 * Whether a slot may move to start at an instant: two hours on a slot hour,
 * in the future, inside the student's move in and, for a direct handoff,
 * the seller's move out, and before PayPal's authorization ends. The screen
 * runs this while a slot is dragged, and the server runs it again before it
 * saves anything.
 */
export function checkSlotMove(slot: Pick<ScheduleSlot, "sellerFirstName" | "limits" | "movable">, startsAt: Date, context: { now: Date; buyerFirstName: string }): SlotCheck {
  const candidate = { startsAt, endsAt: new Date(startsAt.getTime() + SLOT_HOURS * HOUR_MS) };
  const buyer = context.buyerFirstName;
  const seller = slot.sellerFirstName;
  if (!slot.movable || slot.limits === null) return { ok: false, sentence: `${seller}'s handoff has started, so its slot stays.` };
  if (Number.isNaN(startsAt.getTime()) || !isSlotShape(candidate)) return { ok: false, sentence: "Handoffs take two hours and start at 10 AM, noon, 2 PM, 4 PM, or 6 PM." };
  if (candidate.startsAt <= context.now) return { ok: false, sentence: "That time has passed, so pick a later slot." };
  const moveIn = dates(slot.limits.moveIn);
  if (candidate.startsAt < moveIn.startsAt) return { ok: false, sentence: `${buyer} moves in from ${formatMoment(moveIn.startsAt)}, so the handoff cannot be earlier.` };
  if (candidate.endsAt > moveIn.endsAt) return { ok: false, sentence: `${buyer}'s move in ends ${formatMoment(moveIn.endsAt)}, so the handoff cannot be later.` };
  if (slot.limits.moveOut !== null) {
    const moveOut = dates(slot.limits.moveOut);
    if (candidate.startsAt < moveOut.startsAt) return { ok: false, sentence: `${seller} starts moving out ${formatMoment(moveOut.startsAt)}, so the handoff cannot be earlier.` };
    if (candidate.endsAt > moveOut.endsAt) return { ok: false, sentence: `${seller} moves out by ${formatMoment(moveOut.endsAt)}, so the handoff has to be earlier.` };
  }
  if (slot.limits.holdEndsAt !== null && candidate.endsAt > new Date(slot.limits.holdEndsAt)) {
    return { ok: false, sentence: `PayPal holds the payment until ${formatMoment(new Date(slot.limits.holdEndsAt))}, so the handoff has to end by then.` };
  }
  return { ok: true, slot: candidate, sentence: `Moved ${seller}'s handoff to ${formatSlot(candidate)}.` };
}
