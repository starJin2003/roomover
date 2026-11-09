import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { paypalRest } from "@/lib/paypal/rest/client";

/**
 * Records the PayPal response shapes the simulated sandbox answers with in
 * tests. It only reads resources a real handoff already created (an order
 * with its authorization and captures, and a payout batch), so it moves no
 * money. The payer's name, address, and phone are replaced with the judge
 * buyer's public demo values before anything is written.
 *
 *   pnpm paypal:record-fixtures --order <order id> --capture <capture id> --authorization <authorization id> --batch <payout batch id>
 */

const args = new Map(process.argv.slice(2).flatMap((value, index, all) => (value.startsWith("--") ? [[value.slice(2), all[index + 1]]] : [])));
const OUT = "tests/fixtures/paypal-sandbox.json";
const JUDGE_BUYER = { name: { given_name: "Jordan", surname: "Ellis" }, email_address: "roomover-judge-jin0608@personal.example.com" };

function required(name: string): string {
  const value = args.get(name);
  if (value === undefined || !/^[A-Z0-9]{13,17}$/.test(value)) throw new Error(`Pass --${name} with a PayPal ID.`);
  return value;
}

const read = (path: string) => paypalRest().request({ method: "GET", path, schema: z.record(z.string(), z.unknown()) });

/** Drops personal fields PayPal returns about the payer and keeps the shape. */
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value).flatMap(([key, entry]): [string, unknown][] => {
    if (key === "address" || key === "phone" || key === "phone_number" || key === "birth_date") return [];
    if (key === "name" && typeof entry === "object" && entry !== null && "given_name" in entry) return [[key, JUDGE_BUYER.name]];
    if (key === "email_address") return [[key, JUDGE_BUYER.email_address]];
    return [[key, scrub(entry)]];
  });
  return Object.fromEntries(entries);
}

async function main() {
  const order = await read(`/v2/checkout/orders/${required("order")}`);
  const capture = await read(`/v2/payments/captures/${required("capture")}`);
  const authorization = await read(`/v2/payments/authorizations/${required("authorization")}`);
  const payoutBatch = await read(`/v1/payments/payouts/${required("batch")}`);
  const existing = await readFile(OUT, "utf8").then((text) => JSON.parse(text) as { templates?: { userinfo?: unknown } }, () => null);
  const userinfo = existing?.templates?.userinfo;
  if (userinfo === undefined) throw new Error(`${OUT} has no userinfo template to keep.`);
  const recording = { version: 1, recordedAt: new Date().toISOString(), templates: { ...(scrub({ order, capture, authorization, payoutBatch }) as object), userinfo } };
  await writeFile(OUT, `${JSON.stringify(recording, null, 1)}\n`);
  console.log(`Wrote ${OUT}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
