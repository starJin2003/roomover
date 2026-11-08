"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { formatUsdShort } from "@/lib/format";
import { RoomList } from "./room-list";
import type { SceneItem } from "./scene/room-scene";
import type { RoomItemData, RoomPresetData } from "./types";

const RoomCanvas = dynamic(() => import("./room-canvas"), { ssr: false });

/** The room stays empty for a beat, then items land one at a time. */
const HOLD_EMPTY_MS = 1000;
const STEP_MS = 1100;
const FINISH_MS = 900;

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

export function RoomStage({ label, preset, items, playable = false, ring = false }: RoomStageProps) {
  const gl = useWebGlSupport();
  const [ready, setReady] = useState(false);
  const [placed, setPlaced] = useState(items.length);
  const [dropping, setDropping] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ringKey, setRingKey] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [listKey, setListKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const reducedMotion = useReducedMotion();
  const timers = useRef<number[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLDivElement>(null);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  // Plain wheel scrolls the page. A pinch on a trackpad, or Control with the wheel, zooms the room.
  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) event.stopPropagation();
    };
    element.addEventListener("wheel", onWheel, { capture: true });
    return () => element.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  const shown = items.slice(0, placed);
  const sceneItems = useMemo<SceneItem[]>(() => shown.map((data) => ({ data, animate: dropping })), [shown, dropping]);
  const focusKey = hoverKey ?? listKey ?? selectedKey;
  const focused = shown.find((item) => item.layout.key === focusKey);

  const play = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
    setPlaying(true);
    setDropping(true);
    setPlaced(0);
    setRingKey(null);
    setSelectedKey(null);
    setAnnouncement(`${label} is empty. Placing ${items.length} items.`);
    items.forEach((_, index) => {
      timers.current.push(window.setTimeout(() => setPlaced(index + 1), HOLD_EMPTY_MS + index * STEP_MS));
    });
    timers.current.push(window.setTimeout(() => setPlaying(false), HOLD_EMPTY_MS + (items.length - 1) * STEP_MS + FINISH_MS));
  }, [items, label]);

  const onLanded = useCallback(
    (key: string) => {
      if (ring) setRingKey(key);
      if (!dropping) return;
      const index = items.findIndex((item) => item.layout.key === key);
      if (index >= 0) setAnnouncement(`Placed ${items[index].title}. ${index + 1} of ${items.length}.`);
    },
    [dropping, items, ring],
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
  const size = `${(preset.widthMm / 1000).toFixed(1)} by ${(preset.depthMm / 1000).toFixed(1)} meters`;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-room={preset.slug} data-ready={ready} data-placed={placed} data-ring={ringKey ?? ""}>
      <div ref={box} className={`relative w-full ${gl === "no" ? "" : "aspect-[6/5] sm:aspect-[8/7]"} ${hoverKey === null ? "" : "cursor-pointer"}`}>
        {gl === "yes" && (
          <div
            role="img"
            aria-label={`${label}, a ${preset.name} of ${size}, with ${placed} of ${items.length} items placed`}
            className={`absolute inset-0 transition-opacity duration-(--duration-settle) ${ready ? "opacity-100" : "opacity-0"}`}
          >
            <RoomCanvas
              preset={preset}
              items={sceneItems}
              ringKey={ringKey}
              focusKey={focusKey}
              reducedMotion={reducedMotion}
              playing={playing}
              onHover={setHoverKey}
              onSelect={toggle}
              onLanded={onLanded}
              onReady={onReady}
              onAnchor={onAnchor}
            />
          </div>
        )}
        {gl === "no" && (
          <div role="status" className="flex flex-col gap-1 rounded-2xl bg-paper p-5 shadow-sheet">
            <p className="text-base font-semibold">The 3D room needs WebGL</p>
            <p className="text-sm text-flint">This browser cannot draw it, so every item in {label} is listed below in the order it was placed.</p>
          </div>
        )}
        <div ref={tag} aria-hidden="true" className="pointer-events-none invisible absolute top-0 left-0 z-10 max-w-64 rounded-md bg-paper px-3 py-2 shadow-sheet">
          {focused !== undefined && (
            <>
              <p className="text-sm font-semibold">{focused.title}</p>
              <p className="text-xs text-flint">
                {formatUsdShort(focused.priceCents)}, {focused.condition.toLowerCase()}, from {focused.sellerName}
              </p>
            </>
          )}
        </div>
      </div>
      {playable && gl === "yes" && (
        <div>
          <Button variant="secondary" size="sm" onClick={play} disabled={playing || !ready}>
            {playing ? `Placing ${placed} of ${items.length}` : "Play placement"}
          </Button>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <RoomList label={label} items={shown} total={items.length} selectedKey={selectedKey} onActivate={setListKey} onToggle={toggle} />
    </div>
  );
}
