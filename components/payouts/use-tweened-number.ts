import { useEffect, useRef, useState } from "react";

/**
 * Eases a displayed number toward its target over the duration, so a total
 * ticks up as money arrives. With reduced motion it lands on the target in
 * the next frame.
 */
export function useTweenedNumber(target: number, durationMs: number): number {
  const [value, setValue] = useState(target);
  const shown = useRef(target);

  useEffect(() => {
    const from = shown.current;
    if (from === target) return;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : durationMs;
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const progress = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
      const next = from + (target - from) * (1 - (1 - progress) ** 3);
      shown.current = next;
      setValue(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return value;
}
