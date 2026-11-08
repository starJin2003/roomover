import type { SeedResult } from ".";

export function printSeedReport(seeded: SeedResult, rowCounts: Map<string, number>): void {
  console.log("Seeded tables     inserted  updated  unchanged");
  for (const [table, counts] of seeded.tables) {
    const cells = [counts.inserted, counts.updated, counts.unchanged].map((value) => String(value).padStart(9));
    console.log(`${table.padEnd(16)}${cells.join("")}`);
  }
  console.log(`Listings held by open orders and left as they were: ${seeded.heldListingIds.length}`);
  console.log("\nRow counts");
  for (const [table, rows] of rowCounts) console.log(`${table.padEnd(16)}${String(rows).padStart(9)}`);
}
