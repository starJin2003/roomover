export const site = {
  name: "Roomover",
  tagline: "Turning move-out season into move-in opportunities.",
  description: "Claude agents furnish a dorm room in 3D from what students moving out leave behind, and PayPal holds the money until each item passes a photo check at handoff.",
  /** The hosted demo. Social cards link here when APP_URL is not set, as in a build with no environment. */
  url: "https://roomover.onrender.com",
} as const;

/** A path on this deploy as a full URL, whether or not APP_URL ends in a slash. */
export const absoluteUrl = (appUrl: string, path: string) => new URL(path, appUrl).href;
