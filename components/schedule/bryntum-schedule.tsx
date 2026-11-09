"use client";

import "@bryntum/scheduler/scheduler.css";
import "./schedule-theme.css";
import type { ViewPresetConfig } from "@bryntum/scheduler";
import { BryntumScheduler, type BryntumSchedulerProps } from "@bryntum/scheduler-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatSlot } from "@/lib/domain/handoff-slots";
import { checkSlotMove, type ScheduleSlot, type ScheduleView, type SlotCheck } from "@/lib/domain/schedule";
import { fromWall, toWall } from "./campus-wall";

export interface SlotMoveResult {
  ok: boolean;
  sentence: string;
}

interface BryntumScheduleProps {
  schedule: ScheduleView;
  /** Narrow screens get a slimmer name column and ticks. */
  compact: boolean;
  /** A CSS height, which can cap the schedule to part of the screen. */
  height: string;
  onMove: (slot: ScheduleSlot, startsAt: Date) => Promise<SlotMoveResult>;
  onRefused: (sentence: string) => void;
  onDragging: (dragging: boolean) => void;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Slots start on the even hours between 10 AM and 6 PM, so the axis shows exactly those hours. */
const WORKING_TIME = { fromHour: 10, toHour: 20 };

const dayWords = (wall: Date) => `${DAYS[wall.getDay()]}, ${MONTHS[wall.getMonth()]} ${wall.getDate()}`;
const hourWords = (wall: Date) => (wall.getHours() === 12 ? "noon" : `${wall.getHours() % 12} ${wall.getHours() < 12 ? "AM" : "PM"}`);

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

/** The first day anything can be handed over, at the first slot hour, so the view opens with no day label clipped. */
function focusOf(schedule: ScheduleView): Date {
  const first = Math.min(...[...schedule.slots.map((slot) => toWall(slot.startsAt).getTime()), ...(schedule.moveIn === null ? [] : [toWall(schedule.moveIn.startsAt).getTime()])]);
  const focus = Number.isFinite(first) ? new Date(first) : toWall(schedule.span.startsAt);
  focus.setHours(WORKING_TIME.fromHour, 0, 0, 0);
  return focus;
}

/**
 * Every config handed to the scheduler stays the same object across renders,
 * because the wrapper applies a changed prop to the live scheduler and a
 * fresh visible date would scroll the view back while someone drags. The
 * handlers read the latest schedule and callbacks through a ref.
 */
export default function BryntumSchedule(props: BryntumScheduleProps) {
  const { schedule, compact, height } = props;
  const latest = useRef(props);
  const lastCheck = useRef<SlotCheck | null>(null);
  useEffect(() => {
    latest.current = props;
  });

  const [visibleDate] = useState(() => ({ date: focusOf(schedule), block: "start" as const }));
  const { startsAt: spanStart, endsAt: spanEnd } = schedule.span;
  const timeSpan = useMemo(() => ({ startDate: toWall(spanStart), endDate: toWall(spanEnd) }), [spanStart, spanEnd]);

  const data = useMemo(
    () => ({
      resources: schedule.resources.map((row) => ({ id: row.id, name: row.name, detail: row.detail, cls: `rv-row-${row.kind}` })),
      events: schedule.slots.map((slot) => ({
        id: slot.id,
        resourceId: slot.resourceId,
        startDate: toWall(slot.startsAt),
        endDate: toWall(slot.endsAt),
        name: `Handoff with ${slot.sellerFirstName}, ${slot.label}`,
        draggable: slot.movable,
        resizable: false,
        cls: ["rv-slot", slot.agreed ? "" : "rv-slot-open", slot.movable ? "rv-slot-movable" : "rv-slot-fixed"].filter(Boolean).join(" "),
      })),
      ranges: schedule.ranges.map((range) => ({ id: range.id, resourceId: range.resourceId, startDate: toWall(range.startsAt), endDate: toWall(range.endsAt), name: "", cls: `rv-range rv-range-${range.kind}` })),
      band: schedule.moveIn === null ? [] : [{ id: "move-in", startDate: toWall(schedule.moveIn.startsAt), endDate: toWall(schedule.moveIn.endsAt), name: "", cls: "rv-band" }],
    }),
    [schedule],
  );

  const tickWidth = compact ? 44 : 48;
  const viewPreset = useMemo(
    (): ViewPresetConfig => ({
      base: "hourAndDay",
      id: `roomover-slots-${tickWidth}`,
      tickWidth,
      displayDateFormat: "ddd, MMM D, h A",
      timeResolution: { unit: "hour", increment: 2 },
      headers: [
        { unit: "day", align: "start", renderer: (start: Date) => dayWords(start) },
        { unit: "hour", increment: 2, renderer: (start: Date) => hourWords(start) },
      ],
    }),
    [tickWidth],
  );

  const columns = useMemo(
    () => [
      {
        field: "name",
        text: "Who",
        cls: "rv-who-header",
        width: compact ? 104 : 168,
        sortable: false,
        groupable: false,
        draggable: false,
        resizable: false,
        editor: false,
        renderer: ({ record }: { record: { getData: (field: string) => unknown } }) => {
          const name = String(record.getData("name"));
          return {
            class: "rv-who",
            children: [
              { tag: "span", class: "rv-who-name", text: compact ? name.split(" ")[0] : name },
              { tag: "span", class: "rv-who-detail", text: String(record.getData("detail")) },
            ],
          };
        },
      },
    ],
    [compact],
  );

  const handlers = useMemo(() => {
    const check = (id: string, wallStart: Date): SlotCheck | null => {
      const slot = latest.current.schedule.slots.find((candidate) => candidate.id === id);
      if (slot === undefined) return null;
      const startsAt = fromWall(wallStart);
      if (startsAt.getTime() === new Date(slot.startsAt).getTime()) return { ok: true, slot: { startsAt, endsAt: new Date(slot.endsAt) }, sentence: slot.label };
      return checkSlotMove(slot, startsAt, { now: new Date(), buyerFirstName: latest.current.schedule.buyerFirstName });
    };
    const eventDragFeature: BryntumSchedulerProps["eventDragFeature"] = {
      constrainDragToResource: true,
      showExactDropPosition: true,
      tip: { cls: "rv-drag-tip" },
      validatorFn: ({ startDate, eventRecords }: { startDate: Date; eventRecords: { id: string | number }[] }) => {
        const result = check(String(eventRecords[0]?.id), startDate);
        lastCheck.current = result;
        return { valid: result?.ok ?? false, message: result?.sentence ?? "" };
      },
      tooltipTemplate: ({ valid, startDate, eventRecord }: { valid: boolean; startDate: Date; eventRecord: { id: string | number } }) => {
        const result = check(String(eventRecord.id), startDate);
        const text = result === null ? "" : result.ok ? formatSlot(result.slot) : result.sentence;
        return `<div class="rv-tip${valid ? "" : " rv-tip-refused"}">${escapeHtml(text)}</div>`;
      },
    };
    const listeners: Pick<BryntumSchedulerProps, "onRenderEvent" | "onEventDragStart" | "onEventDragAbort" | "onAfterEventDrop" | "onBeforeEventDropFinalize"> = {
      onRenderEvent: ({ element }) => {
        // Bryntum renders each event as a button on a presentational canvas, which leaves buttons directly in a row group.
        // As a row of grid cells, the handoffs form valid grid markup that screen readers can walk.
        const wrap = element.closest(".b-sch-event-wrap") ?? element;
        wrap.setAttribute("role", "gridcell");
        wrap.parentElement?.setAttribute("role", "row");
        wrap.parentElement?.setAttribute("aria-label", "Handoffs");
      },
      onEventDragStart: () => latest.current.onDragging(true),
      onEventDragAbort: () => latest.current.onDragging(false),
      onAfterEventDrop: ({ valid }) => {
        latest.current.onDragging(false);
        const result = lastCheck.current;
        if (!valid && result !== null && !result.ok) latest.current.onRefused(result.sentence);
        lastCheck.current = null;
      },
      onBeforeEventDropFinalize: ({ context }) => {
        const id = String(context.eventRecord.id);
        const slot = latest.current.schedule.slots.find((candidate) => candidate.id === id);
        const result = check(id, context.startDate);
        if (slot === undefined || result === null || !result.ok || fromWall(context.startDate).getTime() === new Date(slot.startsAt).getTime()) {
          context.valid = false;
          return;
        }
        context.async = true;
        void latest.current.onMove(slot, result.slot.startsAt).then((answer) => context.finalize(answer.ok));
      },
    };
    return { eventDragFeature, listeners };
  }, []);

  const eventRenderer = useMemo(() => ({ eventRecord }: { eventRecord: { startDate: Date | string } }) => ({ tag: "span", class: "rv-slot-hour", text: hourWords(new Date(eventRecord.startDate)) }), []);
  const timeRangesFeature = useMemo(() => ({ showHeaderElements: false, enableResizing: false }), []);
  const transition = useMemo(() => ({ changeEvent: false }), []);

  return (
    <div className="rv-schedule" style={{ height }}>
      <BryntumScheduler
        height="100%"
        ariaLabel={`Handoff schedule for ${schedule.buyerFirstName}`}
        startDate={timeSpan.startDate}
        endDate={timeSpan.endDate}
        visibleDate={visibleDate}
        viewPreset={viewPreset}
        workingTime={WORKING_TIME}
        snap
        rowHeight={compact ? 52 : 48}
        barMargin={10}
        eventLayout="none"
        eventStyle={null}
        eventColor={null}
        useInitialAnimation={false}
        transition={transition}
        detectCSSCompatibilityIssues={false}
        zoomOnMouseWheel={false}
        zoomOnTimeAxisDoubleClick={false}
        enableDeleteKey={false}
        enableUndoRedoKeys={false}
        eventSelectionDisabled
        multiEventSelect={false}
        columns={columns}
        resources={data.resources}
        events={data.events}
        resourceTimeRanges={data.ranges}
        timeRanges={data.band}
        eventRenderer={eventRenderer}
        resourceTimeRangesFeature
        timeRangesFeature={timeRangesFeature}
        columnLinesFeature
        eventDragFeature={handlers.eventDragFeature}
        eventEditFeature={false}
        eventMenuFeature={false}
        scheduleMenuFeature={false}
        cellMenuFeature={false}
        headerMenuFeature={false}
        timeAxisHeaderMenuFeature={false}
        eventResizeFeature={false}
        eventDragCreateFeature={false}
        eventDragSelectFeature={false}
        eventTooltipFeature={false}
        scheduleTooltipFeature={false}
        eventCopyPasteFeature={false}
        cellEditFeature={false}
        sortFeature={false}
        groupFeature={false}
        filterBarFeature={false}
        columnReorderFeature={false}
        columnResizeFeature={false}
        rowReorderFeature={false}
        regionResizeFeature={false}
        stripeFeature={false}
        nonWorkingTimeFeature={false}
        eventNonWorkingTimeFeature={false}
        scheduleContextFeature={false}
        {...handlers.listeners}
      />
    </div>
  );
}
