"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { checkSlotMove, type ScheduleSlot, type ScheduleView } from "@/lib/domain/schedule";
import type { HandoffView } from "@/lib/handoff/view";
import type { SlotMoveResult } from "./bryntum-schedule";

const loadScheduler = () => import("./bryntum-schedule");

const HEADER_PX = 56;
const ROW_PX = 48;
const COMPACT_ROW_PX = 52;
const SCROLLBAR_PX = 16;
/** Below this width the name column and ticks slim down, as on a phone. */
const COMPACT_BELOW_PX = 600;

function Waiting({ height }: { height: number | string }) {
  return (
    <div style={{ height }} className="flex items-center justify-center gap-2 rounded-2xl text-sm text-flint shadow-ring">
      <Spinner className="size-3.5" />
      Loading the schedule
    </div>
  );
}

const BryntumSchedule = dynamic(loadScheduler, { ssr: false, loading: () => <Waiting height={240} /> });

type Message = { text: string; tone: "hint" | "busy" | "done" | "refused" };

function Swatch({ kind }: { kind: "move_out" | "hold" | "move_in" | "slot" }) {
  const shape = {
    move_out: "h-2.5 w-6 rounded-full bg-flint",
    hold: "h-0 w-6 border-t-2 border-dotted border-stone",
    move_in: "h-2.5 w-6 rounded-full bg-paper shadow-[inset_0_0_0_1.5px_var(--color-flint)]",
    slot: "h-4 w-6 rounded-sm bg-ink shadow-key-ink",
  }[kind];
  return <span aria-hidden="true" className={`inline-block shrink-0 ${shape}`} />;
}

function Legend({ schedule }: { schedule: ScheduleView }) {
  const holds = schedule.ranges.some((range) => range.kind === "room" || range.kind === "storage");
  const items: { kind: "move_out" | "hold" | "move_in" | "slot"; label: string }[] = [
    { kind: "move_out", label: "Moves out" },
    ...(holds ? [{ kind: "hold" as const, label: `Waits for ${schedule.buyerFirstName}` }] : []),
    { kind: "move_in", label: `${schedule.buyerFirstName} moves in` },
    { kind: "slot", label: "Handoff slot" },
  ];
  return (
    <ul aria-label="What the marks mean" className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-flint">
      {items.map((item) => (
        <li key={item.kind} className="inline-flex items-center gap-2">
          <Swatch kind={item.kind} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

interface ScheduleSectionProps {
  schedule: ScheduleView;
  /** The plan whose handoff slots a drop saves. Without one, a drop is only checked, as on the style guide. */
  planId?: string;
  /** Folds under the room behind one press, which keeps the room large on desktop. */
  collapsible?: boolean;
  onView?: (view: HandoffView) => void;
}

/**
 * The schedule inside Handoff: when each seller moves out, when the student
 * moves in, how long items wait, and the slot each pair of agents agreed on.
 * The Bryntum Scheduler loads only once the section opens or scrolls near,
 * so it never slows the first paint.
 */
export function ScheduleSection({ schedule, planId, collapsible = false, onView }: ScheduleSectionProps) {
  const [open, setOpen] = useState(false);
  const [near, setNear] = useState(false);
  const [width, setWidth] = useState(0);
  const [message, setMessage] = useState<Message | null>(null);
  const [dragging, setDragging] = useState(false);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = frame.current;
    if (element === null) return;
    const resize = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    resize.observe(element);
    if (collapsible) return () => resize.disconnect();
    const seen = new IntersectionObserver(([entry]) => entry.isIntersecting && setNear(true), { rootMargin: "320px 0px" });
    seen.observe(element);
    return () => {
      resize.disconnect();
      seen.disconnect();
    };
  }, [collapsible]);

  const compact = width > 0 && width < COMPACT_BELOW_PX;
  const rows = schedule.resources.length;
  const natural = HEADER_PX + rows * (compact ? COMPACT_ROW_PX : ROW_PX) + SCROLLBAR_PX;
  // On desktop the schedule shares the column with the room, so it stops growing at 42 percent of the screen.
  const height = collapsible ? `min(${natural}px, 42dvh)` : `${natural}px`;
  const movable = schedule.slots.some((slot) => slot.movable);
  const hint: Message | null = movable ? { text: `Drag a handoff to another time while ${schedule.buyerFirstName} is on campus. Moving one changes no payment.`, tone: "hint" } : null;
  const shown = dragging ? null : (message ?? hint);

  const move = async (slot: ScheduleSlot, startsAt: Date): Promise<SlotMoveResult> => {
    if (planId === undefined) {
      const check = checkSlotMove(slot, startsAt, { now: new Date(), buyerFirstName: schedule.buyerFirstName });
      setMessage({ text: check.sentence, tone: check.ok ? "done" : "refused" });
      return { ok: check.ok, sentence: check.sentence };
    }
    setMessage({ text: `Moving ${slot.sellerFirstName}'s handoff`, tone: "busy" });
    try {
      const response = await fetch(`/api/handoff/${planId}/slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderItemIds: slot.orderItemIds, startsAt: startsAt.toISOString() }),
      });
      const body = (await response.json().catch(() => ({}))) as { view?: HandoffView; sentence?: string; error?: string };
      if (body.view !== undefined) onView?.(body.view);
      const text = response.ok ? (body.sentence ?? "") : (body.error ?? `${slot.sellerFirstName}'s handoff stays where it was. Try again in a moment.`);
      setMessage({ text, tone: response.ok ? "done" : "refused" });
      return { ok: response.ok, sentence: text };
    } catch {
      const text = `Roomover could not reach the server, so ${slot.sellerFirstName}'s handoff stays where it was.`;
      setMessage({ text, tone: "refused" });
      return { ok: false, sentence: text };
    }
  };

  const body: ReactNode = (
    <div ref={frame} className="flex min-w-0 flex-col gap-3" data-schedule>
      <p className="text-sm text-flint">{schedule.summary}</p>
      <Legend schedule={schedule} />
      <ul aria-label="Handoff slots" className="sr-only">
        {schedule.slots.map((slot) => (
          <li key={slot.id}>
            {`${slot.sellerFirstName}'s ${slot.nouns}, ${slot.label}`}
          </li>
        ))}
      </ul>
      {(collapsible ? open : near) ? (
        <BryntumSchedule
          schedule={schedule}
          compact={compact}
          height={height}
          onMove={move}
          onRefused={(sentence) => setMessage({ text: sentence, tone: "refused" })}
          onDragging={(now) => {
            setDragging(now);
            if (now) setMessage(null);
          }}
        />
      ) : (
        <Waiting height={height} />
      )}
      <p
        role="status"
        data-schedule-message={shown?.tone ?? "none"}
        className={`flex min-h-5 items-center gap-2 text-sm ${shown?.tone === "refused" ? "font-medium text-brick" : shown?.tone === "done" ? "font-medium text-ink" : "text-flint"}`}
      >
        {shown?.tone === "busy" && <Spinner className="size-3.5" />}
        {shown?.text}
      </p>
    </div>
  );

  if (collapsible) {
    return (
      <details className="group min-w-0 shrink-0" onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary
          onPointerEnter={() => void loadScheduler()}
          onFocus={() => void loadScheduler()}
          className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-md text-sm font-medium [&::-webkit-details-marker]:hidden"
        >
          Schedule
          <ChevronDownIcon className="size-4 transition-transform duration-(--duration-quick) ease-out group-open:rotate-180" />
        </summary>
        <div className="pt-1">{body}</div>
      </details>
    );
  }
  return (
    <section aria-labelledby="schedule-title" className="flex min-w-0 flex-col gap-3">
      <h3 id="schedule-title" className="text-base font-semibold">
        Schedule
      </h3>
      {body}
    </section>
  );
}
