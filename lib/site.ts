export const site = {
  name: "Roomover",
  tagline: "Turning move-out season into move-in opportunities.",
} as const;

/** A path on this deploy as a full URL, whether or not APP_URL ends in a slash. */
export const absoluteUrl = (appUrl: string, path: string) => new URL(path, appUrl).href;
