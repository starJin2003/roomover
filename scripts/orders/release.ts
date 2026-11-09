import { releaseStaleOrders } from "@/lib/handoff/release";
import { paypalSdk } from "@/lib/paypal/server-sdk/client";
import { runScript } from "../db/run";

/**
 * The hourly demo release, run by the roomover-release cron job. Demo orders
 * whose handoff did not start within 2 hours of approval get their money
 * back (a void, or a refund in capture mode), and their listings go back on
 * sale. A failed release stays releasing and finishes on the next run.
 * Prepared orders past PayPal's 6 hour approval window are canceled too.
 *
 *   pnpm orders:release
 */
runScript("Release", async (db) => {
  const report = await releaseStaleOrders({ db, sdk: paypalSdk(), now: () => new Date() });
  console.log(JSON.stringify({ released: report.released.length, orderIds: report.released, canceledUnapproved: report.canceled.length, failed: report.failed }));
  if (report.failed.length > 0) process.exitCode = 1;
});
