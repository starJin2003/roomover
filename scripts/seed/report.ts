import type { UpsertCounts } from "./upsert";

export function printSeedReport(seeded: Map<string, UpsertCounts>, rowCounts: Map<string, number>): void {
  console.log("Seeded tables     inserted  updated  unchanged");
  for (const [table, counts] of seeded) {
    const cells = [counts.inserted, counts.updated, counts.unchanged].map((value) => String(value).padStart(9));
    console.log(`${table.padEnd(16)}${cells.join("")}`);
  }
  console.log("\nRow counts");
  for (const [table, rows] of rowCounts) console.log(`${table.padEnd(16)}${String(rows).padStart(9)}`);
}
