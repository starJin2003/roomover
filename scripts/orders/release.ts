import { releaseStaleOrders } from "@/lib/handoff/release";
import { paypalRest } from "@/lib/paypal/rest/client";
import { paypalSdk } from "@/lib/paypal/server-sdk/client";
import { runScript } from "../db/run";

/**
 * The hourly demo release, run by the roomover-release cron job. Demo orders
 * whose handoff did not start within 2 hours of approval, or started and then
 * sat idle for 6 hours, get their money back (a void, or a refund in capture
 * mode), and their listings go back on sale. A failed release stays
 * releasing and finishes on the next run. A settlement that stopped and saw
 * no change for an hour carries on, or is released in full when it stops
 * again before moving any money. Prepared orders past PayPal's 6
 * hour approval window are canceled, and Sell listings from demo sessions
 * leave the catalog a day after they were listed.
 *
 *   pnpm orders:release
 */
runScript(
  "Release",
  async (db) => {
    const report = await releaseStaleOrders({ db, sdk: paypalSdk(), rest: paypalRest(), now: () => new Date() });
    console.log(JSON.stringify({ released: report.released.length, orders: report.released, resumed: report.resumed, canceledUnapproved: report.canceled.length, sell: report.sell, failed: report.failed }));
    if (report.failed.length > 0) process.exitCode = 1;
  },
  // It voids, refunds, captures, and pays out through PayPal, so it needs the app's credentials before it touches anything.
  { requires: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"] },
);
