import { join } from "node:path";
import { DEMO_ROOM } from "@/lib/demo";

/**
 * The recorded Harbor Hall 214 run, which a web Furnish run replays when the
 * day's Claude allowance or an hourly limit would refuse a live one. The
 * buyer agent's replies, the seller agents' answers, and Channel3's searches
 * come from the recordings the end to end tests replay, so a replay spends
 * no Claude calls or credits. PayPal and everything after it run live.
 */
export const RECORDED_RUN = {
  presetSlug: DEMO_ROOM.presetSlug,
  roomNumber: DEMO_ROOM.roomNumber,
  prompt: "$150, cozy, I study late",
  claude: join(process.cwd(), "tests/fixtures/buyer-agent.json"),
  channel3: join(process.cwd(), "tests/fixtures/channel3.json"),
} as const;

export const REPLAY_SENTENCE = "Today's live agent budget is used up, so this room replays a recorded run, and PayPal and everything after it are live.";
