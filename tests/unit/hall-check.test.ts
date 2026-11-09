import { describe, expect, it } from "vitest";
import { hallRuleViolations, type RuleListing } from "@/lib/domain/hall-check";
import { BREAKWATER_APARTMENTS_RULES, HARBOR_HALL_RULES } from "@/scripts/seed/hall-rules";

function listing(overrides: Partial<RuleListing> = {}): RuleListing {
  return {
    id: "a",
    title: "Desk lamp",
    description: "Warm light.",
    category: "lamp",
    placement: "surface",
    widthMm: 300,
    depthMm: 200,
    heightMm: 450,
    specs: { bulbType: "led", watts: 9 },
    ...overrides,
  };
}

const rules = HARBOR_HALL_RULES.constraints;
const ids = (found: ReturnType<typeof hallRuleViolations>) => found.map((violation) => violation.ruleId);

describe("hallRuleViolations", () => {
  it("passes an LED lamp", () => {
    expect(hallRuleViolations(rules, listing(), [])).toEqual([]);
  });

  it("prohibits halogen lamps only when the category and bulb both match", () => {
    expect(ids(hallRuleViolations(rules, listing({ specs: { bulbType: "halogen" } }), []))).toEqual(["no-halogen"]);
    expect(hallRuleViolations(rules, listing({ category: "storage", specs: { bulbType: "halogen" } }), [])).toEqual([]);
  });

  it("finds prohibited words in the title or description", () => {
    expect(ids(hallRuleViolations(rules, listing({ category: "storage", title: "Scented candle set", specs: {} }), []))).toEqual(["no-open-flame"]);
    expect(ids(hallRuleViolations(rules, listing({ category: "storage", description: "A small space heater for winter.", specs: {} }), []))).toEqual(["no-heating-appliances"]);
  });

  it("limits refrigerator size, power, and count", () => {
    const fridge = listing({ id: "f1", category: "mini_fridge", placement: "floor", specs: { capacityLiters: 48, watts: 80 } });
    expect(hallRuleViolations(rules, fridge, [])).toEqual([]);
    expect(ids(hallRuleViolations(rules, { ...fridge, specs: { capacityLiters: 120, watts: 80 } }, []))).toEqual(["refrigerator-limit"]);
    expect(ids(hallRuleViolations(rules, { ...fridge, specs: { capacityLiters: 48, watts: 250 } }, []))).toEqual(["refrigerator-limit"]);
    expect(ids(hallRuleViolations(rules, { ...fridge, id: "f2" }, [fridge]))).toEqual(["refrigerator-limit"]);
    // A refrigerator already in the plan is not counted against itself when moved.
    expect(hallRuleViolations(rules, fridge, [fridge])).toEqual([]);
  });

  it("applies each hall's own limits", () => {
    const fridge = listing({ category: "mini_fridge", placement: "floor", specs: { capacityLiters: 120 } });
    expect(hallRuleViolations(BREAKWATER_APARTMENTS_RULES.constraints, fridge, [])).toEqual([]);
  });

  it("stops wall items where fasteners are not allowed and risers that lift too high", () => {
    expect(ids(hallRuleViolations(rules, listing({ category: "shelf", placement: "wall", specs: {} }), []))).toEqual(["wall-fasteners"]);
    expect(hallRuleViolations(BREAKWATER_APARTMENTS_RULES.constraints, listing({ category: "shelf", placement: "wall", specs: {} }), [])).toEqual([]);
    expect(ids(hallRuleViolations(rules, listing({ category: "storage", specs: { liftHeightMm: 200 } }), []))).toEqual(["bed-lofting"]);
  });
});
