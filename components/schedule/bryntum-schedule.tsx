"use client";

import "@bryntum/scheduler/scheduler.css";
import "./schedule-theme.css";
import type { EventModel, Scheduler, ViewPresetConfig } from "@bryntum/scheduler";
import { useEffect, useRef, useState } from "react";
import { formatSlot } from "@/lib/domain/handoff-slots";
import { checkSlotMove, type ScheduleSlot, type ScheduleView, type SlotCheck } from "@/lib/domain/schedule";
import { fromWall, toWall } from "./campus-wall";
import { loadBryntum, type BryntumLibrary } from "./load-bryntum";

export type ScheduleZoom = "gap" | "days";

export interface SlotMoveResult {
  ok: boolean;
  sentence: string;
}

export interface ScheduleNotice {
  text: string;
  tone: "pending" | "refused" | "hint";
}

interface BryntumScheduleProps {
  schedule: ScheduleView;
  /** The whole gap from the first move out to the end of move in, or the handoff days hour by hour. */
  zoom: ScheduleZoom;
  /** Narrow screens get a slimmer name column and ticks. */
  compact: boolean;
  /** A CSS height, which can cap the schedule to part of the screen. */
  height: string;
  onMove: (slot: ScheduleSlot, startsAt: Date) => Promise<SlotMoveResult>;
  onNotice: (notice: ScheduleNotice) => void;
  onDragging: (dragging: boolean) => void;
}

type SchedulerConfig = NonNullable<ConstructorParameters<BryntumLibrary["Scheduler"]>[0]>;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 24 * 60 * 60 * 1000;

/** Slots start on the even hours between 10 AM and 6 PM, so the axis shows exactly those hours. */
const WORKING_TIME = { fromHour: 10, toHour: 20 };
const KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", "Escape"]);

const dayWords = (wall: Date) => `${DAYS[wall.getDay()]}, ${MONTHS[wall.getMonth()]} ${wall.getDate()}`;
const hourWords = (wall: Date) => (wall.getHours() === 12 ? "noon" : `${wall.getHours() % 12 || 12} ${wall.getHours() < 12 ? "AM" : "PM"}`);
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
const slotName = (slot: Pick<ScheduleSlot, "sellerFirstName">, label: string) => `Handoff with ${slot.sellerFirstName}, ${label}`;
const slotClass = (slot: ScheduleSlot) => ["rv-slot", slot.agreed ? "" : "rv-slot-open", slot.movable ? "rv-slot-movable" : "rv-slot-fixed"].filter(Boolean).join(" ");
const twoHoursFrom = (wall: Date) => new Date(wall.getTime() + 2 * 60 * 60 * 1000);

/** The first day anything can be handed over, at the first slot hour, so the hour view opens with no day label clipped. */
function focusOf(schedule: ScheduleView): Date {
  const first = Math.min(...[...schedule.slots.map((slot) => toWall(slot.startsAt).getTime()), ...(schedule.moveIn === null ? [] : [toWall(schedule.moveIn.startsAt).getTime()])]);
  const focus = Number.isFinite(first) ? new Date(first) : toWall(schedule.span.startsAt);
  focus.setHours(WORKING_TIME.fromHour, 0, 0, 0);
  return focus;
}

/** Hours for the handoff days, then days, weeks, or months for the whole gap, so the gap always fits the frame. */
function presetFor(schedule: ScheduleView, zoom: ScheduleZoom, compact: boolean): { preset: ViewPresetConfig; hours: boolean } {
  if (zoom === "days") {
    const tickWidth = compact ? 44 : 48;
    return {
      hours: true,
      preset: {
        base: "hourAndDay",
        id: `roomover-slots-${tickWidth}`,
        tickWidth,
        displayDateFormat: "ddd, MMM D, h A",
        timeResolution: { unit: "hour", increment: 2 },
        headers: [
          { unit: "day", align: "start", renderer: (start: Date) => dayWords(start) },
          { unit: "hour", increment: 2, renderer: (start: Date) => hourWords(start) },
        ],
      },
    };
  }
  const days = Math.round((toWall(schedule.span.endsAt).getTime() - toWall(schedule.span.startsAt).getTime()) / DAY_MS);
  // Over a month or less a drag still snaps to the two hour slots, and longer gaps move a slot by whole days.
  const timeResolution = { unit: "day", increment: 1 } as const;
  if (days <= 31) {
    return {
      hours: true,
      preset: {
        base: "dayAndWeek",
        id: "roomover-gap-days",
        timeResolution: { unit: "hour", increment: 2 },
        headers: [
          { unit: "month", align: "start", renderer: (start: Date) => `${MONTHS[start.getMonth()]} ${start.getFullYear()}` },
          // A whole gap gives a day 30 to 60 px, so the date stands alone and the slots carry their weekday in words.
          { unit: "day", renderer: (start: Date) => String(start.getDate()) },
        ],
      },
    };
  }
  if (days <= 140) {
    return {
      hours: false,
      preset: {
        base: "weekAndMonth",
        id: "roomover-gap-weeks",
        timeResolution,
        headers: [
          { unit: "month", align: "start", renderer: (start: Date) => MONTHS[start.getMonth()] },
          { unit: "week", renderer: (start: Date) => String(start.getDate()) },
        ],
      },
    };
  }
  return {
    hours: false,
    preset: {
      base: "monthAndYear",
      id: "roomover-gap-months",
      timeResolution,
      headers: [
        { unit: "year", align: "start", renderer: (start: Date) => String(start.getFullYear()) },
        { unit: "month", renderer: (start: Date) => MONTHS[start.getMonth()] },
      ],
    },
  };
}

function storeData(schedule: ScheduleView) {
  return {
    resources: schedule.resources.map((row) => ({ id: row.id, name: row.name, detail: row.detail, cls: `rv-row-${row.kind}` })),
    events: schedule.slots.map((slot) => ({
      id: slot.id,
      resourceId: slot.resourceId,
      startDate: toWall(slot.startsAt),
      endDate: toWall(slot.endsAt),
      name: slotName(slot, slot.label),
      draggable: slot.movable,
      resizable: false,
      cls: slotClass(slot),
    })),
    resourceTimeRanges: schedule.ranges.map((range) => ({ id: range.id, resourceId: range.resourceId, startDate: toWall(range.startsAt), endDate: toWall(range.endsAt), name: "", cls: `rv-range rv-range-${range.kind}` })),
    timeRanges: schedule.moveIn === null ? [] : [{ id: "move-in", startDate: toWall(schedule.moveIn.startsAt), endDate: toWall(schedule.moveIn.endsAt), name: "", cls: "rv-band" }],
  };
}

interface Pending {
  id: string;
  wall: Date;
}

/**
 * Bryntum's scheduler, driven directly. The page builds a new scheduler when
 * the zoom or the width class changes and hands later schedules to the live
 * one, so a saved move never scrolls the view. Dragging and the keyboard run
 * the same check the server runs before it saves a slot.
 */
export default function BryntumSchedule(props: BryntumScheduleProps) {
  const { schedule, zoom, compact, height } = props;
  const latest = useRef(props);
  const holder = useRef<HTMLDivElement>(null);
  const scheduler = useRef<Scheduler | null>(null);
  const pending = useRef<Pending | null>(null);
  const [library, setLibrary] = useState<BryntumLibrary | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    let live = true;
    loadBryntum()
      .then((loaded) => live && setLibrary(loaded))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const element = holder.current;
    if (library === null || element === null) return;
    const first = latest.current.schedule;
    const slotOf = (id: string) => latest.current.schedule.slots.find((candidate) => candidate.id === id);
    const notice = (text: string, tone: ScheduleNotice["tone"]) => latest.current.onNotice({ text, tone });
    let lastCheck: SlotCheck | null = null;

    const check = (id: string, wallStart: Date): SlotCheck | null => {
      const slot = slotOf(id);
      if (slot === undefined) return null;
      const startsAt = fromWall(wallStart);
      if (startsAt.getTime() === new Date(slot.startsAt).getTime()) return { ok: true, slot: { startsAt, endsAt: new Date(slot.endsAt) }, sentence: slot.label };
      return checkSlotMove(slot, startsAt, { now: new Date(), buyerFirstName: latest.current.schedule.buyerFirstName });
    };

    const record = (id: string) => (scheduler.current?.eventStore.getById(id) ?? null) as EventModel | null;
    const keyOf = (id: string) => element.querySelector<HTMLElement>(`.b-sch-event-wrap[data-event-id="${CSS.escape(id)}"]`);
    const keepFocus = (id: string) => {
      requestAnimationFrame(() => {
        const key = keyOf(id);
        if (key !== null && !key.contains(document.activeElement)) key.focus({ preventScroll: true });
      });
    };
    const restore = (id: string) => {
      const slot = slotOf(id);
      if (slot === undefined) return;
      record(id)?.set({ startDate: toWall(slot.startsAt), endDate: toWall(slot.endsAt), name: slotName(slot, slot.label), cls: slotClass(slot) });
    };
    const cancel = (announce: boolean) => {
      const moving = pending.current;
      if (moving === null) return;
      pending.current = null;
      restore(moving.id);
      const slot = slotOf(moving.id);
      if (announce && slot !== undefined) notice(`${slot.sellerFirstName}'s handoff stays at ${slot.label}.`, "hint");
    };

    const step = (id: string, key: string) => {
      const slot = slotOf(id);
      if (slot === undefined) return;
      if (!slot.movable) {
        notice(checkSlotMove(slot, new Date(slot.startsAt), { now: new Date(), buyerFirstName: latest.current.schedule.buyerFirstName }).sentence, "refused");
        return;
      }
      if (pending.current !== null && pending.current.id !== id) cancel(false);
      const wall = new Date(pending.current?.wall ?? toWall(slot.startsAt));
      if (key === "ArrowLeft") wall.setHours(wall.getHours() - 1);
      if (key === "ArrowRight") wall.setHours(wall.getHours() + 1);
      if (key === "ArrowUp") wall.setDate(wall.getDate() - 1);
      if (key === "ArrowDown") wall.setDate(wall.getDate() + 1);
      pending.current = { id, wall };
      const result = check(id, wall);
      const when = formatSlot({ startsAt: fromWall(wall), endsAt: fromWall(twoHoursFrom(wall)) });
      const valid = result?.ok === true;
      record(id)?.set({ startDate: wall, endDate: twoHoursFrom(wall), name: slotName(slot, when), cls: `${slotClass(slot)} rv-slot-pending${valid ? "" : " rv-slot-refused"}` });
      keepFocus(id);
      notice(valid ? `${slot.sellerFirstName}'s handoff, ${when}. Press Enter to save or Escape to cancel.` : `${slot.sellerFirstName}'s handoff, ${when}. ${result?.sentence ?? ""}`, valid ? "pending" : "refused");
    };

    const save = async (id: string) => {
      const moving = pending.current;
      const slot = slotOf(id);
      if (moving === null || moving.id !== id || slot === undefined) return;
      const result = check(id, moving.wall);
      if (result === null || !result.ok) {
        notice(`${slot.sellerFirstName}'s handoff cannot move there. ${result?.sentence ?? ""}`, "refused");
        return;
      }
      if (result.slot.startsAt.getTime() === new Date(slot.startsAt).getTime()) {
        cancel(true);
        return;
      }
      const answer = await latest.current.onMove(slot, result.slot.startsAt);
      if (pending.current?.id === id) pending.current = null;
      if (!answer.ok) restore(id);
      keepFocus(id);
    };

    const onKey = (event: KeyboardEvent) => {
      const key = (event.target as Element | null)?.closest?.<HTMLElement>(".b-sch-event-wrap[data-event-id]");
      const id = key?.dataset.eventId;
      if (id === undefined || !KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") cancel(true);
      else if (event.key === "Enter") void save(id);
      else step(id, event.key);
    };
    element.addEventListener("keydown", onKey, true);

    const { preset, hours } = presetFor(first, latest.current.zoom, latest.current.compact);
    const span = { startDate: toWall(first.span.startsAt), endDate: toWall(first.span.endsAt) };
    const gap = latest.current.zoom === "gap";
    const config: SchedulerConfig = {
      appendTo: element,
      height: "100%",
      ariaLabel: `Handoff schedule for ${first.buyerFirstName}`,
      ...span,
      ...(gap ? { forceFit: true } : { visibleDate: { date: focusOf(first), block: "start" } }),
      viewPreset: preset,
      ...(hours ? { workingTime: WORKING_TIME } : {}),
      snap: true,
      rowHeight: latest.current.compact ? 52 : 48,
      barMargin: 10,
      eventLayout: "none",
      eventStyle: null,
      eventColor: null,
      useInitialAnimation: false,
      transition: { changeEvent: false },
      detectCSSCompatibilityIssues: false,
      zoomOnMouseWheel: false,
      zoomOnTimeAxisDoubleClick: false,
      enableDeleteKey: false,
      enableUndoRedoKeys: false,
      eventSelectionDisabled: true,
      multiEventSelect: false,
      // The keys belong to slot moves, which the handler above runs.
      keyMap: { ArrowLeft: null, ArrowRight: null, ArrowUp: null, ArrowDown: null, Enter: null, Escape: null, " ": null },
      columns: [
        {
          field: "name",
          text: "Who",
          cls: "rv-who-header",
          width: latest.current.compact ? 104 : 168,
          sortable: false,
          groupable: false,
          draggable: false,
          resizable: false,
          editor: false,
          renderer: ({ record: row }: { record: { getData: (field: string) => unknown } }) => {
            const name = String(row.getData("name"));
            return {
              class: "rv-who",
              children: [
                { tag: "span", class: "rv-who-name", text: latest.current.compact ? name.split(" ")[0] : name },
                { tag: "span", class: "rv-who-detail", text: String(row.getData("detail")) },
              ],
            };
          },
        },
      ],
      ...storeData(first),
      eventRenderer: ({ eventRecord }: { eventRecord: { startDate: Date | string } }) => ({ tag: "span", class: "rv-slot-hour", text: hourWords(new Date(eventRecord.startDate)) }),
      features: {
        // Move outs and waits are marks, not controls, so they stay out of the tab order and only the slots take focus.
        resourceTimeRanges: { tabIndex: -1 },
        timeRanges: { showHeaderElements: false, enableResizing: false },
        columnLines: true,
        eventDrag: {
          constrainDragToResource: true,
          showExactDropPosition: true,
          tip: { cls: "rv-drag-tip" },
          validatorFn: ({ startDate, eventRecords }: { startDate: Date; eventRecords: { id: string | number }[] }) => {
            const result = check(String(eventRecords[0]?.id), startDate);
            lastCheck = result;
            return { valid: result?.ok ?? false, message: result?.sentence ?? "" };
          },
          tooltipTemplate: ({ valid, startDate, eventRecord }: { valid: boolean; startDate: Date; eventRecord: { id: string | number } }) => {
            const result = check(String(eventRecord.id), startDate);
            const text = result === null ? "" : result.ok ? formatSlot(result.slot) : result.sentence;
            return `<div class="rv-tip${valid ? "" : " rv-tip-refused"}">${escapeHtml(text)}</div>`;
          },
        },
        eventEdit: false,
        eventMenu: false,
        scheduleMenu: false,
        cellMenu: false,
        headerMenu: false,
        timeAxisHeaderMenu: false,
        eventResize: false,
        eventDragCreate: false,
        eventDragSelect: false,
        eventTooltip: false,
        scheduleTooltip: false,
        eventCopyPaste: false,
        cellEdit: false,
        sort: false,
        group: false,
        filterBar: false,
        columnReorder: false,
        columnResize: false,
        rowReorder: false,
        regionResize: false,
        stripe: false,
        nonWorkingTime: false,
        eventNonWorkingTime: false,
        scheduleContext: false,
      },
      listeners: {
        renderEvent: ({ element: rendered, eventRecord }) => {
          // Bryntum renders each event as a button on a presentational canvas, which leaves buttons directly in a row group.
          // As a row of grid cells, the handoffs form valid grid markup that screen readers can walk.
          const wrap = rendered.closest(".b-sch-event-wrap") ?? rendered;
          wrap.setAttribute("role", "gridcell");
          wrap.parentElement?.setAttribute("role", "row");
          wrap.parentElement?.setAttribute("aria-label", "Handoffs");
          if (slotOf(String(eventRecord.id))?.movable) {
            wrap.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown Enter Escape");
            wrap.setAttribute("aria-describedby", "schedule-keys");
          }
        },
        eventDragStart: () => {
          cancel(false);
          latest.current.onDragging(true);
        },
        eventDragAbort: () => latest.current.onDragging(false),
        afterEventDrop: ({ valid }) => {
          latest.current.onDragging(false);
          if (!valid && lastCheck !== null && !lastCheck.ok) notice(lastCheck.sentence, "refused");
          lastCheck = null;
        },
        beforeEventDropFinalize: ({ context }) => {
          const id = String(context.eventRecord.id);
          const slot = slotOf(id);
          const result = check(id, context.startDate);
          if (slot === undefined || result === null || !result.ok || fromWall(context.startDate).getTime() === new Date(slot.startsAt).getTime()) {
            context.valid = false;
            return;
          }
          context.async = true;
          void latest.current.onMove(slot, result.slot.startsAt).then((answer) => context.finalize(answer.ok));
        },
      },
    };
    scheduler.current = new library.Scheduler(config);
    return () => {
      element.removeEventListener("keydown", onKey, true);
      pending.current = null;
      scheduler.current?.destroy();
      scheduler.current = null;
    };
  }, [library, zoom, compact]);

  // A saved move or a fresh read hands the live scheduler new data, which keeps its scroll position.
  useEffect(() => {
    const live = scheduler.current;
    if (live === null) return;
    pending.current = null;
    const data = storeData(schedule);
    live.events = data.events;
    live.resourceTimeRanges = data.resourceTimeRanges;
    live.timeRanges = data.timeRanges;
  }, [schedule]);

  if (failed) {
    return (
      <p role="alert" className="text-sm font-medium text-brick">
        The schedule did not load. Check the connection and reload the page.
      </p>
    );
  }
  return <div ref={holder} className={`rv-schedule rv-zoom-${zoom}`} style={{ height }} />;
}
