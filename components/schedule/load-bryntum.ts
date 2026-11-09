export type BryntumLibrary = typeof import("@bryntum/scheduler");

/** Copied from node_modules by scripts/bryntum-assets.mjs before each build. */
export const BRYNTUM_SCRIPT = "/bryntum/scheduler.umd.js";

let loading: Promise<BryntumLibrary> | null = null;

const loaded = () => (globalThis as { bryntum?: { scheduler?: BryntumLibrary } }).bryntum?.scheduler;

/**
 * Loads Bryntum's prebuilt scheduler as a plain script, once per page. The
 * bundler never sees it, and the first call starts the download, so hovering
 * the Schedule heading can warm it up before the section opens.
 */
export function loadBryntum(): Promise<BryntumLibrary> {
  loading ??= new Promise<BryntumLibrary>((resolve, reject) => {
    const ready = loaded();
    if (ready !== undefined) return resolve(ready);
    const script = document.createElement("script");
    script.src = BRYNTUM_SCRIPT;
    script.async = true;
    script.onload = () => {
      const library = loaded();
      if (library === undefined) reject(new Error("The schedule script loaded without the scheduler."));
      else resolve(library);
    };
    script.onerror = () => reject(new Error("The schedule script did not load."));
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}
