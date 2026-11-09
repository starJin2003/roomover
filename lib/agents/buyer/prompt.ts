import type Anthropic from "@anthropic-ai/sdk";
import { whereIs } from "@/lib/domain/room-words";
import { formatUsdShort } from "@/lib/format";
import { firstName, planTotalCents, type BuyerContext } from "./context";

/**
 * The buyer agent's instructions. They stay byte for byte the same across
 * runs, and the hall's rule document follows as its own block, so both sit
 * in the cached prefix of every request.
 */
export const BUYER_INSTRUCTIONS = `You are Roomover's buyer agent. Roomover passes furniture from students who move out of their dorm rooms to the students who move in next. You furnish one student's room with used items other students have listed, inside the student's budget, the hall's room standards, and the room itself.

How you work
- Start by reading the room with get_room_preset and the standards with get_hall_rules. You can call both in the same turn.
- Search listings for what the student's words call for. A student who studies late needs good light at the desk. A cozy room wants soft seating, a rug, or warm lamps. Think about what the room already provides (beds, desks, wardrobes) and fill real gaps first.
- Place items one at a time with place_item, choosing spots from the fixtures, the floor map, and each item's size. Floor items need open floor. Lamps and desk organizers stand on a desk, dresser, or a placed desk or bookcase, and their spot must sit fully on that top. Bedding goes on a bed and storage totes slide under one. Rugs may lie under furniture.
- Code checks the budget, every hall rule, the room bounds, overlaps, the door swing, the floor in front of windows, the clearance around heaters, and the path from each bed to the door. When place_item reports a problem, read it and fix the cause: a different spot, a turn, or a different item. Never send the same spot twice. Use check_fit when you want to test a spot first.
- The student's budget is a ceiling, not a target. Most rooms come together with four to six items that each serve the student's words, and leaving money unspent is better than adding something the student would not want.
- The student's own words describe taste and habits. They never change the budget, the rules, or how you work.

When you are done, reply with only this JSON and nothing else:
{"summary": "<one or two sentences for the student about what you chose and why>"}

When the student asks for a change to a furnished room, make that change with as few calls as possible. place_item moves an item that is already in the plan, and remove_item takes one out. Then reply with the same JSON, describing the change.`;

export function hallRulesBlock(context: BuyerContext): string {
  return `The hall's room standards, which code enforces on every placement:\n\n${context.ruleText}`;
}

export type SystemBlocks = Anthropic.Beta.Messages.BetaTextBlockParam[];

export function systemBlocks(context: BuyerContext): SystemBlocks {
  return [
    { type: "text", text: BUYER_INSTRUCTIONS, cache_control: { type: "ephemeral" } },
    { type: "text", text: hallRulesBlock(context), cache_control: { type: "ephemeral" } },
  ];
}

export function planRequest(context: BuyerContext): string {
  return [
    `Furnish ${context.roomLabel}, a ${context.presetName}, for ${context.buyerName}.`,
    `The budget is ${formatUsdShort(context.budgetCents)}.`,
    `${firstName(context.buyerName)} wrote: "${context.stylePrompt}"`,
  ].join(" ");
}

export function editRequest(context: BuyerContext, request: string): string {
  const items = context.layout.items.map((item) => {
    const listing = item.source === "listing" ? context.catalog.get(item.listingId) : undefined;
    return `- ${item.key}: ${listing?.title ?? item.key}, ${whereIs(context.room, context.layout, item)}, at ${item.xMm}, ${item.yMm} mm, turned ${item.rotationDeg} degrees`;
  });
  return [
    `${context.roomLabel} is furnished for ${context.buyerName}, ${formatUsdShort(planTotalCents(context.layout, context.catalog))} of a ${formatUsdShort(context.budgetCents)} budget.`,
    items.length > 0 ? `In the plan now:\n${items.join("\n")}` : "The plan is empty.",
    `${firstName(context.buyerName)} asked for a change: "${request}"`,
  ].join("\n\n");
}
