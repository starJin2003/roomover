import type { ReactNode } from "react";
import { SiteHeader } from "./site-header";

/**
 * A working screen. On desktop it is exactly one viewport tall, the header
 * on top and the screen's columns under it, so content scrolls inside the
 * panel and the page itself never does. Phones scroll the page as usual.
 */
export function ScreenFrame({ person, children }: { person?: string | null; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:min-h-[600px]">
      <SiteHeader person={person} />
      {children}
    </div>
  );
}

/** The two columns of a working screen: the room or photo at left, the panel at right, sharing one height on desktop. */
export const SHELL_COLUMNS =
  "mx-auto grid w-full max-w-[1360px] gap-6 px-4 sm:px-10 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_440px] lg:grid-rows-[minmax(0,1fr)] lg:gap-12 lg:pb-8";
