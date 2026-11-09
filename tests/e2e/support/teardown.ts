import { removeSessionData } from "./remove-session";
import { E2E_TAG } from "./session";

/** Sweeps tagged data a stopped run left behind, after each test has cleaned up its own. */
export default async function teardown(): Promise<void> {
  const removed = await removeSessionData({ prefix: E2E_TAG });
  if (removed.plans > 0) console.log(`Removed ${removed.plans} leftover e2e plans and ${removed.orders} orders.`);
}
