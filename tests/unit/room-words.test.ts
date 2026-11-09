import { describe, expect, it } from "vitest";
import { checkFit } from "@/lib/domain/fit";
import type { PlanLayout } from "@/lib/domain/layout";
import { layoutItemFor, putItem, settle } from "@/lib/domain/placement";
import { fitProblemWords, itemNoun, whereIs, withArticle } from "@/lib/domain/room-words";
import { harborContext, listingId } from "./support/buyer-context";

const context = harborContext();
function place(layout: PlanLayout, slug: string, xMm: number, yMm: number, rotationDeg = 0): PlanLayout {
  const listing = context.catalog.get(listingId(slug));
  if (listing === undefined) throw new Error(`No listing ${slug}.`);
  return putItem(layout, settle(context.room, layout, layoutItemFor(listing, { xMm, yMm, rotationDeg }, layout)));
}
const last = (layout: PlanLayout) => layout.items[layout.items.length - 1];

describe("item nouns", () => {
  it("names sets as sets and picks the article", () => {
    expect(itemNoun({ furnitureType: "pouf", pieces: 3 })).toBe("set of poufs");
    expect(itemNoun({ furnitureType: "pouf", pieces: 1 })).toBe("pouf");
    expect(withArticle("armchair")).toBe("an armchair");
    expect(withArticle("desk")).toBe("a desk");
  });
});

describe("whereIs", () => {
  it("says where items stand in everyday words", () => {
    let layout = place({ items: [] }, "jun-white-desk", 1800, 600);
    expect(whereIs(context.room, layout, last(layout))).toBe("under the window");
    layout = place(layout, "ava-desk-lamp", 2150, 480);
    expect(whereIs(context.room, layout, last(layout))).toBe("on the desk");
    layout = place(layout, "sofia-clamp-lamp", 950, 140);
    expect(whereIs(context.room, layout, last(layout))).toBe("on the west desk");
    layout = place(layout, "lea-crochet-throw", 457, 2800);
    expect(whereIs(context.room, layout, last(layout))).toBe("on the west bed");
    layout = place(layout, "lea-moving-tote", 3143, 2400);
    expect(whereIs(context.room, layout, last(layout))).toBe("under the east bed");
    layout = place(layout, "lea-navy-bean-bag", 1750, 2150);
    expect(whereIs(context.room, layout, last(layout))).toBe("in the middle of the room");
    layout = place(layout, "marcus-bell-floor-lamp", 1200, 2000);
    expect(whereIs(context.room, layout, last(layout))).toBe("beside the west bed");
  });
});

describe("fitProblemWords", () => {
  it("turns fit problems into sentences a student understands", () => {
    const layout = place({ items: [] }, "lea-navy-bean-bag", 457, 2874);
    const problems = checkFit(context.room, { items: [] }, layout.items[0]).problems;
    expect(problems.map((problem) => fitProblemWords(problem, layout))).toContain("It would overlap the west bed.");
    expect(fitProblemWords({ code: "egress_blocked", itemKey: "x", otherKey: "east bed", message: "" }, layout)).toBe("It would block the path from the east bed to the door.");
    expect(fitProblemWords({ code: "no_support", itemKey: "x", message: "" }, layout)).toBe("It needs a desk or shelf under it.");
    expect(fitProblemWords({ code: "door_swing", itemKey: "x", message: "" }, layout)).toBe("It would block the door.");
  });
});
