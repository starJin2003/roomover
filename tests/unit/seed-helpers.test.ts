import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { listings } from "@/lib/db/schema";
import { seedId } from "@/scripts/seed/ids";
import { conflictUpdate, upsertCounts } from "@/scripts/seed/upsert";

describe("seedId", () => {
  it("gives a stable version 5 UUID per kind and slug", () => {
    const id = seedId("listing", "ava-led-desk-lamp");
    expect(id).toBe(seedId("listing", "ava-led-desk-lamp"));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(seedId("user", "ava-led-desk-lamp")).not.toBe(id);
  });
});

describe("conflictUpdate", () => {
  it("updates seeded columns from excluded and only when one of them changed", () => {
    const { set, setWhere } = conflictUpdate(listings, ["id", "priceCents", "photos"]);
    expect(Object.keys(set)).toEqual(["priceCents", "photos"]);
    const where = new PgDialect().sqlToQuery(setWhere).sql;
    expect(where).toBe(
      '("listings"."price_cents" is distinct from excluded."price_cents" or "listings"."photos" is distinct from excluded."photos")',
    );
  });

  it("rejects unknown columns and an empty column list", () => {
    expect(() => conflictUpdate(listings, ["id", "brand"])).toThrow("listings has no column brand.");
    expect(() => conflictUpdate(listings, ["id"])).toThrow("set no columns");
  });
});

describe("upsertCounts", () => {
  it("splits returned rows into inserts and updates and counts skipped rows as unchanged", () => {
    expect(upsertCounts(5, [{ inserted: true }, { inserted: false }])).toEqual({ inserted: 1, updated: 1, unchanged: 3 });
    expect(upsertCounts(3, [])).toEqual({ inserted: 0, updated: 0, unchanged: 3 });
  });
});
