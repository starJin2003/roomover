"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { CloseIcon, RotateIcon } from "@/components/ui/icons";
import { checkFit, type FitRoom } from "@/lib/domain/fit";
import type { LayoutItem, PlanLayout } from "@/lib/domain/layout";
import { moveItem, type Spot } from "@/lib/domain/placement";
import { fitProblemWords, itemNoun, whereIs } from "@/lib/domain/room-words";
import { formatUsdShort } from "@/lib/format";
import { RoomList } from "./room-list";
import type { DragStart, PlanPoint, SceneItem } from "./scene/room-scene";
import type { RoomItemData, RoomPresetData } from "./types";

const RoomCanvas = dynamic(() => import("./room-canvas"), { ssr: false });

/** Play placement holds the room empty for a beat, then items land one at a time. */
const HOLD_EMPTY_MS = 1000;
const PLAY_STEP_MS = 1100;
/** Items that arrive together from the agent land this far apart. */
const ARRIVAL_STEP_MS = 700;
const FINISH_MS = 900;
const SNAP_MM = 50;
const NUDGE_MM = 50;
const BIG_NUDGE_MM = 200;
/** A press that moves less than this is a click that selects. */
const CLICK_MM = 30;
const KEYBOARD_SAVE_MS = 450;

export type MoveResult = { ok: true } | { ok: false; message: string };

export interface RoomEditing {
  room: FitRoom;
  onMove: (key: string, spot: Spot) => Promise<MoveResult>;
  /** Why moving is paused, such as the agent working on the room. */
  locked?: string | null;
}

interface RoomStageProps {
  /** Names the room, such as Harbor Hall 214. */
  label: string;
  preset: RoomPresetData;
  /** Placed items in the order they land. */
  items: readonly RoomItemData[];
  /** Shows the Play placement control. */
  playable?: boolean;
  /** Marks the last placed item with the Sky ring. */
  ring?: boolean;
  showList?: boolean;
  /** Lets the student drag, turn, and nudge items, with the same fit check the agent faces. */
  editing?: RoomEditing | null;
  /** Rings one item and keeps its tag up, such as the next item to check at handoff. */
  mark?: { key: string; label: string } | null;
}

type GlSupport = "checking" | "yes" | "no";

let support: GlSupport | undefined;

function detectWebGl(): GlSupport {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (context === null) return "no";
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return "yes";
  } catch {
    return "no";
  }
}

const noSubscription = () => () => {};

/** Checks once per page, on the client only. The server render waits as "checking". */
function useWebGlSupport(): GlSupport {
  return useSyncExternalStore(
    noSubscription,
    () => (support ??= detectWebGl()),
    () => "checking",
  );
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(REDUCED_MOTION);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

interface Draft {
  key: string;
  spot: Spot;
  layout: PlanLayout;
  moved: ReadonlySet<string>;
  /** Everyday sentences for what fails at this spot. Empty means it fits. */
  problems: readonly string[];
}

const snap = (value: number) => Math.round(value / SNAP_MM) * SNAP_MM;
const clamp = (value: number, max: number) => Math.min(Math.max(0, value), max);

export function RoomStage({ label, preset, items, playable = false, ring = false, showList = true, editing = null, mark = null }: RoomStageProps) {
  const gl = useWebGlSupport();
  const reducedMotion = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState<ReadonlySet<string>>(() => new Set(items.map((item) => item.layout.key)));
  const [animating, setAnimating] = useState<ReadonlySet<string>>(() => new Set());
  const [queued, setQueued] = useState<readonly string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [ringKey, setRingKey] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [listKey, setListKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drag, setDrag] = useState<DragStart | null>(null);
  const [saving, setSaving] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const timers = useRef<number[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLDivElement>(null);
  const grab = useRef<{ origin: PlanPoint | null; offset: PlanPoint; travel: number; wasSelected: boolean }>({ origin: null, offset: { x: 0, y: 0 }, travel: 0, wasSelected: false });
  const keyboardSave = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(keyboardSave.current);
    },
    [],
  );

  // The wheel alone scrolls the page. A pinch on a trackpad, or Control with the wheel, zooms the room.
  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) event.stopPropagation();
    };
    element.addEventListener("wheel", onWheel, { capture: true });
    return () => element.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  // New items from the agent join a queue and land one at a time. Removed items leave at once.
  // This adjusts state while rendering, which React allows for a component's own state.
  const keys = useMemo(() => items.map((item) => item.layout.key), [items]);
  const [seenKeys, setSeenKeys] = useState(keys);
  if (seenKeys !== keys) {
    setSeenKeys(keys);
    const present = new Set(keys);
    const kept = [...visible].filter((key) => present.has(key));
    const nextVisible = kept.length === visible.size ? visible : new Set(kept);
    const waiting = queued.filter((key) => present.has(key) && !nextVisible.has(key));
    const fresh = keys.filter((key) => !nextVisible.has(key) && !waiting.includes(key));
    if (nextVisible !== visible) setVisible(nextVisible);
    if (fresh.length > 0 || waiting.length !== queued.length) setQueued([...waiting, ...fresh]);
  }

  useEffect(() => {
    if (queued.length === 0 || playing) return;
    const timer = window.setTimeout(() => {
      const [next, ...rest] = queued;
      setVisible((current) => new Set([...current, next]));
      setAnimating((current) => new Set([...current, next]));
      setQueued(rest);
    }, animating.size === 0 && visible.size === 0 ? 0 : ARRIVAL_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [queued, playing, animating.size, visible.size]);

  const layout = useMemo<PlanLayout>(() => ({ items: items.map((item) => item.layout) }), [items]);
  const display = useMemo(
    () =>
      items.map((item) => {
        const moved = draft?.moved.has(item.layout.key) === true ? draft.layout.items.find((candidate) => candidate.key === item.layout.key) : undefined;
        return moved === undefined ? item : { ...item, layout: moved };
      }),
    [items, draft],
  );
  const shown = display.filter((item) => visible.has(item.layout.key));
  const sceneItems = useMemo<SceneItem[]>(
    () => shown.map((data) => ({ data, animate: animating.has(data.layout.key), held: draft?.moved.has(data.layout.key) === true })),
    [shown, animating, draft],
  );
  const pointedKey = drag === null ? (hoverKey ?? listKey ?? selectedKey) : null;
  const focusKey = pointedKey ?? (drag === null ? (mark?.key ?? null) : null);
  const focused = shown.find((item) => item.layout.key === focusKey);
  const markTag = pointedKey === null && mark !== null && focused?.layout.key === mark.key ? mark.label : null;
  const ringShown = mark === null ? ringKey : mark.key;
  const selected = editing === null ? undefined : shown.find((item) => item.layout.key === selectedKey);
  const invalid = draft !== null && draft.problems.length > 0;
  const locked = editing?.locked ?? null;

  const play = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
    setPlaying(true);
    setVisible(new Set());
    setAnimating(new Set());
    setQueued([]);
    setRingKey(null);
    setSelectedKey(null);
    setAnnouncement(`${label} is empty. Placing ${items.length} items.`);
    items.forEach((item, index) => {
      timers.current.push(
        window.setTimeout(() => {
          setVisible((current) => new Set([...current, item.layout.key]));
          setAnimating((current) => new Set([...current, item.layout.key]));
        }, HOLD_EMPTY_MS + index * PLAY_STEP_MS),
      );
    });
    timers.current.push(window.setTimeout(() => setPlaying(false), HOLD_EMPTY_MS + (items.length - 1) * PLAY_STEP_MS + FINISH_MS));
  }, [items, label]);

  const onLanded = useCallback(
    (key: string) => {
      if (ring) setRingKey(key);
      // Live screens announce arrivals through their activity feed, so only Play placement speaks here.
      if (!playing || !animating.has(key)) return;
      const index = items.findIndex((item) => item.layout.key === key);
      if (index >= 0) setAnnouncement(`Placed ${items[index].title}. ${index + 1} of ${items.length}.`);
    },
    [animating, items, playing, ring],
  );

  const onAnchor = useCallback((point: { x: number; y: number } | null) => {
    const element = tag.current;
    const frame = box.current;
    if (element === null || frame === null) return;
    if (point === null) {
      element.style.visibility = "hidden";
      return;
    }
    const x = Math.min(Math.max(point.x - element.offsetWidth / 2, 8), frame.clientWidth - element.offsetWidth - 8);
    const y = Math.max(8, point.y - element.offsetHeight - 12);
    element.style.transform = `translate(${x}px, ${y}px)`;
    element.style.visibility = "visible";
  }, []);

  const onReady = useCallback(() => setReady(true), []);
  const toggle = useCallback((key: string) => setSelectedKey((current) => (current === key ? null : key)), []);

  /** The item at a new spot, with everything that moves with it and every problem at that spot. */
  const propose = useCallback(
    (key: string, spot: Spot): Draft | null => {
      if (editing === null) return null;
      const move = moveItem(editing.room, layout, key, spot);
      const problems = move.moved.flatMap((item) => checkFit(editing.room, move.layout, item).problems.map((problem) => fitProblemWords(problem, move.layout)));
      return { key, spot, layout: move.layout, moved: new Set(move.moved.map((item) => item.key)), problems: [...new Set(problems)] };
    },
    [editing, layout],
  );

  const savedItem = useCallback((key: string): LayoutItem | undefined => layout.items.find((item) => item.key === key), [layout]);

  const commit = useCallback(
    async (proposal: Draft) => {
      if (editing === null) return;
      const item = items.find((candidate) => candidate.layout.key === proposal.key);
      const noun = item === undefined ? "item" : itemNoun(item.layout);
      if (proposal.problems.length > 0) {
        setDraft(null);
        setAnnouncement(`The ${noun} went back. ${proposal.problems[0]}`);
        return;
      }
      setSaving(true);
      const result = await editing.onMove(proposal.key, proposal.spot);
      setSaving(false);
      setDraft(null);
      if (result.ok) {
        const moved = proposal.layout.items.find((candidate) => candidate.key === proposal.key);
        setAnnouncement(moved === undefined ? `Moved the ${noun}.` : `Moved the ${noun} ${whereIs(editing.room, proposal.layout, moved)}.`);
      } else {
        setAnnouncement(`The ${noun} went back. ${result.message}`);
      }
    },
    [editing, items],
  );

  const onGrab = useCallback(
    (start: DragStart) => {
      if (editing === null || saving) return;
      if (locked !== null) {
        setAnnouncement(locked);
        return;
      }
      grab.current = { origin: null, offset: { x: 0, y: 0 }, travel: 0, wasSelected: selectedKey === start.key };
      setSelectedKey(start.key);
      setDrag(start);
    },
    [editing, locked, saving, selectedKey],
  );

  const onDragMove = useCallback(
    (point: PlanPoint) => {
      if (drag === null || editing === null) return;
      const item = savedItem(drag.key);
      if (item === undefined) return;
      const state = grab.current;
      if (state.origin === null) {
        state.origin = point;
        state.offset = { x: item.xMm - point.x, y: item.yMm - point.y };
        return;
      }
      state.travel = Math.max(state.travel, Math.hypot(point.x - state.origin.x, point.y - state.origin.y));
      if (state.travel < CLICK_MM) return;
      const spot = {
        xMm: clamp(snap(point.x + state.offset.x), editing.room.widthMm),
        yMm: clamp(snap(point.y + state.offset.y), editing.room.depthMm),
        rotationDeg: item.rotationDeg,
      };
      setDraft((current) => (current !== null && current.key === drag.key && current.spot.xMm === spot.xMm && current.spot.yMm === spot.yMm ? current : propose(drag.key, spot)));
    },
    [drag, editing, propose, savedItem],
  );

  const onDragEnd = useCallback(() => {
    const ended = drag;
    setDrag(null);
    if (ended === null) return;
    if (grab.current.travel < CLICK_MM) {
      setDraft(null);
      if (grab.current.wasSelected) setSelectedKey(null);
      return;
    }
    setDraft((current) => {
      if (current !== null) void commit(current);
      return current;
    });
  }, [commit, drag]);

  /** Moves or turns the selected item from the keyboard or the Turn key. Valid spots save after a short pause. */
  const nudge = useCallback(
    (key: string, change: (spot: Spot) => Spot, saveDelay: number) => {
      if (editing === null || saving) return;
      if (locked !== null) {
        setAnnouncement(locked);
        return;
      }
      const item = savedItem(key);
      if (item === undefined) return;
      const base = draft !== null && draft.key === key ? draft.spot : { xMm: item.xMm, yMm: item.yMm, rotationDeg: item.rotationDeg };
      const next = change(base);
      const proposal = propose(key, {
        xMm: clamp(next.xMm, editing.room.widthMm),
        yMm: clamp(next.yMm, editing.room.depthMm),
        rotationDeg: ((next.rotationDeg % 360) + 360) % 360,
      });
      if (proposal === null) return;
      setDraft(proposal);
      window.clearTimeout(keyboardSave.current);
      if (proposal.problems.length > 0) {
        setAnnouncement(`That spot does not work. ${proposal.problems[0]}`);
        return;
      }
      keyboardSave.current = window.setTimeout(() => void commit(proposal), saveDelay);
    },
    [commit, draft, editing, locked, propose, savedItem, saving],
  );

  const turn = useCallback(() => {
    if (selectedKey !== null) nudge(selectedKey, (spot) => ({ ...spot, rotationDeg: spot.rotationDeg + 90 }), 0);
  }, [nudge, selectedKey]);

  const onRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, key: string) => {
      if (editing === null) return;
      const step = event.shiftKey ? BIG_NUDGE_MM : NUDGE_MM;
      const moves: Record<string, (spot: Spot) => Spot> = {
        ArrowUp: (spot) => ({ ...spot, yMm: spot.yMm - step }),
        ArrowDown: (spot) => ({ ...spot, yMm: spot.yMm + step }),
        ArrowLeft: (spot) => ({ ...spot, xMm: spot.xMm - step }),
        ArrowRight: (spot) => ({ ...spot, xMm: spot.xMm + step }),
        r: (spot) => ({ ...spot, rotationDeg: spot.rotationDeg + 90 }),
        R: (spot) => ({ ...spot, rotationDeg: spot.rotationDeg - 90 }),
      };
      const move = moves[event.key];
      if (move !== undefined) {
        event.preventDefault();
        setSelectedKey(key);
        nudge(key, move, KEYBOARD_SAVE_MS);
      } else if (event.key === "Escape" && draft !== null) {
        event.preventDefault();
        window.clearTimeout(keyboardSave.current);
        setDraft(null);
        setAnnouncement("Back where it was.");
      }
    },
    [draft, editing, nudge],
  );

  // A spot that fails stays shown only while the student is still moving that item.
  const onRowBlur = useCallback(() => {
    if (draft !== null && draft.problems.length > 0 && drag === null) setDraft(null);
  }, [draft, drag]);

  const size = `${(preset.widthMm / 1000).toFixed(1)} by ${(preset.depthMm / 1000).toFixed(1)} meters`;
  const active = playing || queued.length > 0 || drag !== null;

  return (
    <div
      className="flex min-w-0 flex-col gap-4"
      data-room={preset.slug}
      data-ready={ready}
      data-placed={shown.length}
      data-ring={ringShown ?? ""}
      data-selected={selected?.layout.key ?? ""}
      data-invalid={invalid}
    >
      <div ref={box} data-room-box className={`relative w-full ${gl === "no" ? "" : "aspect-[6/5] sm:aspect-[8/7]"} ${hoverKey === null ? "" : editing === null ? "cursor-pointer" : "cursor-grab"}`}>
        {gl === "yes" && (
          <div
            role="img"
            aria-label={`${label}, a ${preset.name} of ${size}, with ${shown.length} of ${items.length} items placed`}
            className={`absolute inset-0 transition-opacity duration-(--duration-settle) ${ready ? "opacity-100" : "opacity-0"}`}
          >
            <RoomCanvas
              preset={preset}
              items={sceneItems}
              ringKey={ringShown}
              focusKey={focusKey}
              reducedMotion={reducedMotion}
              playing={active}
              onHover={setHoverKey}
              onSelect={toggle}
              onLanded={onLanded}
              onReady={onReady}
              onAnchor={onAnchor}
              editable={editing !== null && locked === null}
              outline={selected === undefined ? null : { key: selected.layout.key, invalid: invalid && draft?.moved.has(selected.layout.key) === true }}
              drag={drag}
              onGrab={onGrab}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
            />
          </div>
        )}
        {gl === "no" && (
          <div role="status" className="flex flex-col gap-1 rounded-2xl bg-paper p-5 shadow-sheet">
            <p className="text-base font-semibold">The 3D room needs WebGL</p>
            <p className="text-sm text-flint">This browser cannot draw it, so every item in {label} is listed below in the order it was placed.</p>
          </div>
        )}
        <div ref={tag} aria-hidden="true" data-room-tag className="pointer-events-none invisible absolute top-0 left-0 z-10 max-w-64 rounded-md bg-paper px-3 py-2 shadow-sheet">
          {markTag !== null && <p className="text-sm font-semibold">{markTag}</p>}
          {focused !== undefined && markTag === null && (
            <>
              <p className="text-sm font-semibold">{focused.title}</p>
              <p className="text-xs text-flint">
                {formatUsdShort(focused.priceCents)}, {focused.condition.toLowerCase()}, from {focused.sellerName}
              </p>
            </>
          )}
        </div>
      </div>
      {selected !== undefined && gl === "yes" && (
        <div data-room-toolbar className="flex items-center gap-2 rounded-xl bg-paper py-1.5 pr-1.5 pl-4 shadow-sheet">
          <p className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold">{selected.title}</span>
            <span className={`text-xs text-pretty ${invalid ? "font-medium text-brick" : "text-flint"}`}>
              {locked ?? (invalid ? draft?.problems[0] : saving ? "Saving" : "Drag it to move it, or turn it")}
            </span>
          </p>
          <Button variant="secondary" size="sm" onClick={turn} disabled={locked !== null || saving}>
            <RotateIcon className="size-4" />
            Turn
          </Button>
          <Button variant="quiet" size="sm" square aria-label={`Done moving the ${itemNoun(selected.layout)}`} onClick={() => setSelectedKey(null)}>
            <CloseIcon className="size-4" />
          </Button>
        </div>
      )}
      {playable && gl === "yes" && (
        <div>
          <Button variant="secondary" size="sm" onClick={play} disabled={playing || !ready}>
            {playing ? `Placing ${shown.length} of ${items.length}` : "Play placement"}
          </Button>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {showList && (
        <RoomList
          label={label}
          items={shown}
          total={items.length}
          selectedKey={selectedKey}
          onActivate={setListKey}
          onToggle={toggle}
          editing={editing === null ? undefined : { onKeyDown: onRowKeyDown, onBlur: onRowBlur, invalidKey: invalid ? (draft?.key ?? null) : null }}
        />
      )}
    </div>
  );
}
