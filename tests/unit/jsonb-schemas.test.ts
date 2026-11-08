import { describe, expect, it } from "vitest";
import { evidenceBundleSchema } from "@/lib/domain/dispute";
import { handoffPhotosSchema, verificationReportSchema } from "@/lib/domain/handoff";
import { hallConstraintsSchema } from "@/lib/domain/hall-rules";
import {
  conditionReportSchema,
  listingPhotosSchema,
  listingSpecsSchema,
  retailReferenceSchema,
} from "@/lib/domain/listing";
import { offersLogSchema } from "@/lib/domain/negotiation";
import { planLayoutSchema } from "@/lib/domain/layout";
import { geometryProblems, roomGeometrySchema, type RoomGeometry } from "@/lib/domain/room";

const LISTING_ID = "3f0c8a8e-2a4b-5c1d-9e7f-0a1b2c3d4e5f";

describe("room geometry", () => {
  const geometry: RoomGeometry = {
    doors: [{ wall: "south", offsetMm: 200, widthMm: 915, heightMm: 2030, swing: "in", hinge: "left" }],
    windows: [{ wall: "north", offsetMm: 900, widthMm: 1200, heightMm: 1500, sillHeightMm: 800 }],
    fixtures: [
      { kind: "bed", label: "Bed", xMm: 500, yMm: 1100, widthMm: 990, depthMm: 2030, heightMm: 650, rotationDeg: 0 },
    ],
  };
  const room = { widthMm: 3000, depthMm: 4000, ceilingHeightMm: 2600 };

  it("accepts a room with a door, a window, and a fixture inside the walls", () => {
    expect(roomGeometrySchema.parse(geometry)).toEqual(geometry);
    expect(geometryProblems(geometry, room)).toEqual([]);
  });

  it("rejects a room without a door, a negative offset, and an unknown key", () => {
    expect(roomGeometrySchema.safeParse({ ...geometry, doors: [] }).success).toBe(false);
    const badWindow = { ...geometry.windows[0], offsetMm: -1 };
    expect(roomGeometrySchema.safeParse({ ...geometry, windows: [badWindow] }).success).toBe(false);
    expect(roomGeometrySchema.safeParse({ ...geometry, color: "white" }).success).toBe(false);
  });

  it("rejects rotations that are not quarter turns", () => {
    const fixture = { ...geometry.fixtures[0], rotationDeg: 45 };
    expect(roomGeometrySchema.safeParse({ ...geometry, fixtures: [fixture] }).success).toBe(false);
  });

  it("reports openings past a wall and fixtures off the floor, counting the quarter turn", () => {
    const wide: RoomGeometry = {
      ...geometry,
      windows: [{ ...geometry.windows[0], offsetMm: 2000 }],
      fixtures: [{ ...geometry.fixtures[0], xMm: 600, rotationDeg: 90 }],
    };
    expect(geometryProblems(wide, room)).toEqual(["window 0 runs past the north wall", "Bed leaves the floor"]);
    const unturned: RoomGeometry = { ...geometry, fixtures: [{ ...geometry.fixtures[0], xMm: 600 }] };
    expect(geometryProblems(unturned, room)).toEqual([]);
  });
});

describe("listing JSONB", () => {
  it("accepts a condition report and rejects an unknown grade", () => {
    const report = {
      grade: "good",
      notes: "Light wear on the top.",
      defects: [{ location: "top", description: "Two faint rings", severity: "minor" }],
      assessedBy: "seller",
    };
    expect(conditionReportSchema.parse(report)).toEqual(report);
    expect(conditionReportSchema.safeParse({ ...report, grade: "mint" }).success).toBe(false);
  });

  it("requires integer cents and an ISO date in the retail reference", () => {
    const reference = {
      productName: "Three shelf bookcase",
      newPriceCents: 6_900,
      source: "seed_estimate",
      sourceNote: "Typical new price.",
      checkedOn: "2026-11-08",
    };
    expect(retailReferenceSchema.parse(reference)).toEqual(reference);
    expect(retailReferenceSchema.safeParse({ ...reference, newPriceCents: 69.5 }).success).toBe(false);
    expect(retailReferenceSchema.safeParse({ ...reference, checkedOn: "November 8" }).success).toBe(false);
    expect(retailReferenceSchema.safeParse({ ...reference, url: "http://example.com" }).success).toBe(false);
  });

  it("needs at least one photo with a public path or an HTTPS URL", () => {
    const photo = { src: "/seed/listings/desk.jpg", alt: "Desk", widthPx: 1200, heightPx: 800 };
    expect(listingPhotosSchema.parse([photo])).toEqual([photo]);
    expect(listingPhotosSchema.safeParse([]).success).toBe(false);
    expect(listingPhotosSchema.safeParse([{ ...photo, src: "../secret.jpg" }]).success).toBe(false);
    expect(listingPhotosSchema.parse([{ ...photo, src: "https://cdn.example.com/a.jpg" }])).toHaveLength(1);
  });

  it("limits specs to the known attributes", () => {
    expect(listingSpecsSchema.parse({ bulbType: "halogen", watts: 300 })).toEqual({ bulbType: "halogen", watts: 300 });
    expect(listingSpecsSchema.safeParse({ bulbType: "neon" }).success).toBe(false);
    expect(listingSpecsSchema.safeParse({ brand: "Acme" }).success).toBe(false);
  });
});

describe("hall constraints", () => {
  it("accepts each constraint kind", () => {
    const constraints = [
      { id: "no-halogen", section: "1.1", summary: "No halogen.", kind: "prohibited_item", match: { bulbTypes: ["halogen"] } },
      { id: "fridge", section: "1.2", summary: "Small fridges.", kind: "category_limit", category: "mini_fridge", maxCapacityLiters: 113 },
      { id: "loft", section: "3.2", summary: "Risers only.", kind: "bed_lofting", residentLoftingAllowed: false, maxRiserLiftMm: 152 },
      { id: "egress", section: "2.2", summary: "Clear path.", kind: "egress_clearance", minPathWidthMm: 915 },
      { id: "walls", section: "3.3", summary: "No nails.", kind: "wall_mounting", fastenersAllowed: false },
    ];
    expect(hallConstraintsSchema.parse(constraints)).toHaveLength(5);
  });

  it("rejects duplicate IDs, empty matchers, and limits with no limit", () => {
    const rule = { id: "a", section: "1", summary: "x", kind: "egress_clearance", minPathWidthMm: 900 };
    expect(hallConstraintsSchema.safeParse([rule, rule]).success).toBe(false);
    expect(
      hallConstraintsSchema.safeParse([{ id: "b", section: "1", summary: "x", kind: "prohibited_item", match: {} }])
        .success,
    ).toBe(false);
    expect(
      hallConstraintsSchema.safeParse([
        { id: "c", section: "1", summary: "x", kind: "category_limit", category: "rug" },
      ]).success,
    ).toBe(false);
  });
});

describe("plan layout", () => {
  const item = {
    key: "lamp-1",
    furnitureType: "desk_lamp",
    placement: "surface",
    widthMm: 180,
    depthMm: 160,
    heightMm: 460,
    pieces: 1,
    xMm: 800,
    yMm: 400,
    elevationMm: 750,
    rotationDeg: 90,
  };

  it("accepts listing and new product items", () => {
    const layout = {
      items: [
        { ...item, source: "listing", listingId: LISTING_ID },
        { ...item, key: "rug-1", furnitureType: "rug", placement: "underlay", elevationMm: 0, source: "new_product", channel3ProductId: "c3-1", productName: "Rug", priceCents: 4_500 },
      ],
    };
    expect(planLayoutSchema.parse(layout).items).toHaveLength(2);
  });

  it("rejects duplicate keys, a repeated listing, and a new product without a price", () => {
    const listingItem = { ...item, source: "listing", listingId: LISTING_ID };
    expect(planLayoutSchema.safeParse({ items: [listingItem, listingItem] }).success).toBe(false);
    expect(planLayoutSchema.safeParse({ items: [listingItem, { ...listingItem, key: "lamp-2" }] }).success).toBe(false);
    expect(
      planLayoutSchema.safeParse({ items: [{ ...item, source: "new_product", channel3ProductId: "c3", productName: "Rug" }] })
        .success,
    ).toBe(false);
  });

  it("takes any whole degree of rotation and rejects unknown furniture types", () => {
    const listingItem = { ...item, source: "listing", listingId: LISTING_ID };
    expect(planLayoutSchema.safeParse({ items: [{ ...listingItem, rotationDeg: 45 }] }).success).toBe(true);
    expect(planLayoutSchema.safeParse({ items: [{ ...listingItem, rotationDeg: 360 }] }).success).toBe(false);
    expect(planLayoutSchema.safeParse({ items: [{ ...listingItem, rotationDeg: 12.5 }] }).success).toBe(false);
    expect(planLayoutSchema.safeParse({ items: [{ ...listingItem, furnitureType: "lamp" }] }).success).toBe(false);
    expect(planLayoutSchema.safeParse({ items: [{ ...listingItem, pieces: 0 }] }).success).toBe(false);
  });
});

describe("negotiation, handoff, and dispute JSONB", () => {
  it("accepts an offers log and rejects a slot that ends before it starts", () => {
    const offer = {
      round: 1,
      from: "buyer",
      action: "offer",
      priceCents: 1_200,
      handoffSlot: { startsAt: "2027-01-02T10:00:00-06:00", endsAt: "2027-01-02T11:00:00-06:00" },
      message: "Would 12 dollars work with pickup on Saturday morning?",
      at: "2026-11-20T18:00:00Z",
    };
    expect(offersLogSchema.parse([offer])).toHaveLength(1);
    const backwards = { ...offer, handoffSlot: { startsAt: offer.handoffSlot.endsAt, endsAt: offer.handoffSlot.startsAt } };
    expect(offersLogSchema.safeParse([backwards]).success).toBe(false);
  });

  it("accepts handoff photos and a verification report", () => {
    expect(handoffPhotosSchema.parse([{ src: "/uploads/h1.jpg", takenAt: "2027-01-02T10:05:00-06:00" }])).toHaveLength(1);
    const report = {
      itemPresent: true,
      matchesListing: true,
      newDefects: [{ location: "left leg", description: "Fresh scratch", severity: "minor" }],
      recommendedDecision: "adjusted",
      summary: "Same desk, one new scratch.",
      model: "claude-sonnet-5-5",
      comparedAt: "2027-01-02T10:06:00-06:00",
    };
    expect(verificationReportSchema.parse(report)).toEqual(report);
    expect(verificationReportSchema.safeParse({ ...report, recommendedDecision: "maybe" }).success).toBe(false);
  });

  it("caps dispute notes at 2000 characters", () => {
    const bundle = {
      notes: "Handoff photos match the listing.",
      listingPhotos: ["/seed/listings/a.jpg"],
      handoffPhotos: ["/uploads/a.jpg"],
      comparisonSummary: "No new damage.",
      timeline: [{ at: "2027-01-02T10:00:00-06:00", event: "Handoff verified" }],
    };
    expect(evidenceBundleSchema.parse(bundle)).toEqual(bundle);
    expect(evidenceBundleSchema.safeParse({ ...bundle, notes: "x".repeat(2001) }).success).toBe(false);
  });
});
