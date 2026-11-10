import { z } from "zod";
import type { WindowCount } from "@/lib/agents/limits";
import type { PresetWithRules } from "@/lib/db/plans";
import type { AgentEventDetail } from "@/lib/domain/agent-events";
import type { HandoffMode, PaymentMode } from "@/lib/domain/enums";
import { assistantName, decideMcpPlanLimit, previewPath } from "@/lib/domain/mcp";
import { readPlanPrompt } from "@/lib/domain/plan-request";
import { formatUsdShort } from "@/lib/format";
import type { PlanView } from "@/lib/plan-view";
import { absoluteUrl } from "@/lib/site";
import { handoffPlace } from "./catalog";

/**
 * plan_room and create_checkout. An outside assistant plans a room with the
 * real buyer agent and gets back a link the student opens to see it, then a
 * PayPal approval link. Neither tool approves anything or moves money. The
 * student approves in PayPal, and the preview page authorizes the order.
 */

const HOUR_MS = 60 * 60 * 1000;

/** The MCP session a tool call belongs to, as the handlers see it. */
export interface McpCaller {
  /** The demo buyer session this MCP session acts through, which owns its plans. */
  buyerSession: string;
  clientHash: string;
  /** The name the MCP client gave for itself, such as claude-code. */
  clientName: string | undefined;
}

/** What one tool call leaves in agent_events. */
export interface McpRecord {
  planId: string | null;
  summary: string;
  sentence?: string;
  paypal?: { api: string; id: string };
  detail?: AgentEventDetail;
}

export type ToolOutcome<T> = { ok: true; data: T; text: string; record: McpRecord } | { ok: false; message: string; record: McpRecord };

const refuse = (message: string, planId: string | null = null): ToolOutcome<never> => ({ ok: false, message, record: { planId, summary: message } });

export const planRoomInput = z.object({
  roomPresetSlug: z.string().min(1).max(80).describe("The room to furnish, as a slug from get_room_presets."),
  request: z
    .string()
    .min(1)
    .max(280)
    .describe('The student\'s budget and how they live, in their own words, such as "$150, cozy, I study late". It has to name one budget from $20 to $2,000.'),
});
export type PlanRoomInput = z.infer<typeof planRoomInput>;

const plannedItemSchema = z.object({
  title: z.string(),
  kind: z.enum(["used", "new"]),
  from: z.string(),
  price: z.string(),
  askingPrice: z.string().nullable(),
  condition: z.string(),
  handoffSlot: z.string().nullable(),
  /** Where the item changes hands, from the listing's handoff mode: in person, from campus storage, or left in the room. */
  handoffPlace: z.string().nullable(),
  buyUrl: z.string().nullable(),
});

export const planRoomOutput = z.object({
  planId: z.uuid(),
  room: z.string(),
  status: z.enum(["ready", "planning", "failed"]),
  summary: z.string(),
  budget: z.string(),
  paypalTotal: z.string(),
  newItemsTotal: z.string(),
  savings: z.string().nullable(),
  items: z.array(plannedItemSchema),
  previewUrl: z.url(),
  nextStep: z.string(),
});
export type PlanRoomOutput = z.infer<typeof planRoomOutput>;

export interface StartedRun {
  id: string;
}

export interface PlanRoomDeps {
  now(): Date;
  appUrl: string;
  presets(): Promise<PresetWithRules[]>;
  /** The demo student's own room for a preset, such as 214 in Harbor Hall. */
  roomNumberFor(preset: PresetWithRules): string | null;
  recentPlans(buyerSession: string, since: Date): Promise<WindowCount>;
  createPlan(input: { buyerSession: string; preset: PresetWithRules; roomNumber: string | null; budgetCents: number; prompt: string }): Promise<{ id: string; roomLabel: string }>;
  deletePlan(planId: string): Promise<void>;
  /** Writes the line that says the assistant asked, before the run's own lines. */
  recordRequest(planId: string, record: Omit<McpRecord, "planId">, caller: McpCaller): Promise<void>;
  /** Starts the buyer agent, or throws the error that refused it, such as a limit. */
  startRun(planId: string, preset: PresetWithRules, caller: McpCaller): Promise<StartedRun>;
  /** A sentence the panel would show, or null when the error is not a refusal the caller can act on. */
  refusalOf(error: unknown): string | null;
  /** Waits for the run, handing on each activity sentence. */
  waitForRun(planId: string, runId: string, onSentence: (sentence: string) => void, signal: AbortSignal): Promise<"finished" | "timeout">;
  view(planId: string, preset: PresetWithRules): Promise<PlanView>;
  /** Each listing's stored handoff mode. */
  handoffModes(listingIds: readonly string[]): Promise<ReadonlyMap<string, HandoffMode>>;
}

function itemsOf(view: PlanView, modes: ReadonlyMap<string, HandoffMode>): PlanRoomOutput["items"] {
  return view.items.map((item) => ({
    title: item.title,
    kind: item.newFrom === undefined ? "used" : "new",
    from: item.sellerName,
    price: formatUsdShort(item.priceCents),
    askingPrice: item.listPriceCents !== undefined && item.listPriceCents > item.priceCents ? formatUsdShort(item.listPriceCents) : null,
    condition: item.newFrom === undefined ? item.condition : "New",
    handoffSlot: item.slotLabel ?? null,
    handoffPlace: item.layout.source === "listing" ? handoffPlace(modes.get(item.layout.listingId) ?? "direct", item.sellerName, view.roomLabel) : null,
    buyUrl: item.newFrom?.buyUrl ?? null,
  }));
}

/** One paragraph the assistant can relay, with the numbers the student cares about. */
export function planSummary(view: PlanView): string {
  const used = view.items.filter((item) => item.newFrom === undefined);
  const added = view.items.length - used.length;
  if (view.items.length === 0) return `Nothing fit ${view.roomLabel} within ${formatUsdShort(view.budgetCents)} this time.`;
  const sellers = new Set(used.map((item) => item.sellerName)).size;
  const usedWords = `${used.length} used ${used.length === 1 ? "item" : "items"} from ${sellers} ${sellers === 1 ? "student" : "students"} for ${formatUsdShort(view.usedCents)} through one PayPal approval`;
  const newWords = added === 0 ? "" : `, plus ${added} new ${added === 1 ? "item" : "items"} for ${formatUsdShort(view.newItemsCents)} the student buys from the retailer`;
  return `${view.roomLabel} has ${usedWords}${newWords}, ${formatUsdShort(view.totalCents)} of a ${formatUsdShort(view.budgetCents)} budget.`;
}

/** ", handed over in person by Ava, Mon, Nov 23, 10 AM to noon" for a used item, nothing for a new one. */
function handoffLine(item: PlanRoomOutput["items"][number]): string {
  if (item.handoffPlace === null) return "";
  const place = item.handoffPlace.charAt(0).toLowerCase() + item.handoffPlace.slice(1);
  return `, ${place}${item.handoffSlot === null ? "" : `, ${item.handoffSlot}`}`;
}

const savingsWords = (view: PlanView) =>
  view.savings.savedCents > 0 ? `${formatUsdShort(view.savings.savedCents)} less than the cheapest comparable new items on Channel3.` : null;

/**
 * Plans a room with the real buyer agent: it reads the room and the hall's
 * rules, searches listings, negotiates with seller agents, fills gaps from
 * Channel3, and prepares the PayPal order. The call waits for the run and
 * passes each activity sentence on as progress.
 */
export async function planRoom(deps: PlanRoomDeps, caller: McpCaller, input: PlanRoomInput, onProgress: (sentence: string) => void, signal: AbortSignal): Promise<ToolOutcome<PlanRoomOutput>> {
  const reading = readPlanPrompt(input.request);
  if (!reading.ok) return refuse(reading.error);
  const preset = (await deps.presets()).find((candidate) => candidate.slug === input.roomPresetSlug);
  if (preset === undefined) return refuse(`There is no room called ${input.roomPresetSlug}. Call get_room_presets for the room slugs.`);
  const now = deps.now();
  const limit = decideMcpPlanLimit(await deps.recentPlans(caller.buyerSession, new Date(now.getTime() - HOUR_MS)), now);
  if (!limit.allowed) return refuse(limit.message);

  const plan = await deps.createPlan({ buyerSession: caller.buyerSession, preset, roomNumber: deps.roomNumberFor(preset), budgetCents: reading.budgetCents, prompt: reading.prompt });
  await deps.recordRequest(plan.id, {
    summary: `plan_room for ${plan.roomLabel} with "${reading.prompt}" from MCP client ${caller.clientName ?? "unnamed"}.`,
    sentence: `${assistantName(caller.clientName)} asked Roomover over MCP to furnish ${plan.roomLabel} for “${reading.prompt}”`,
  }, caller);
  let run: StartedRun;
  try {
    run = await deps.startRun(plan.id, preset, caller);
  } catch (error) {
    const refusal = deps.refusalOf(error);
    await deps.deletePlan(plan.id);
    if (refusal === null) throw error;
    return refuse(refusal);
  }

  const waited = await deps.waitForRun(plan.id, run.id, onProgress, signal);
  const view = await deps.view(plan.id, preset);
  const modes = await deps.handoffModes(view.items.flatMap((item) => (item.layout.source === "listing" ? [item.layout.listingId] : [])));
  const previewUrl = absoluteUrl(deps.appUrl, previewPath(plan.id));
  const status = waited === "timeout" || view.run?.status === "running" ? "planning" : view.run?.status === "failed" ? "failed" : "ready";
  const summary =
    status === "planning"
      ? `The buyer agent is still placing items in ${view.roomLabel}. The preview link shows the room as it fills.`
      : status === "failed"
        ? `The buyer agent stopped. ${view.run?.error ?? ""} Items already placed stay in the room.`.trim()
        : planSummary(view);
  const payable = status !== "planning" && view.items.some((item) => item.newFrom === undefined);
  const data: PlanRoomOutput = {
    planId: plan.id,
    room: view.roomLabel,
    status,
    summary,
    budget: formatUsdShort(view.budgetCents),
    paypalTotal: formatUsdShort(view.usedCents),
    newItemsTotal: formatUsdShort(view.newItemsCents),
    savings: savingsWords(view),
    items: itemsOf(view, modes),
    previewUrl,
    nextStep: payable
      ? "Share previewUrl with the student so they can see the room. When they want it, call create_checkout with this planId for a PayPal approval link. Nothing is charged until the student approves in PayPal."
      : status === "planning"
        ? "Share previewUrl with the student. Call create_checkout with this planId once the room is ready."
        : "Try plan_room again with a larger budget or different words.",
  };
  const lines = data.items.map((item) => `- ${item.title}, ${item.kind === "new" ? `new from ${item.from}` : `from ${item.from}`}, ${item.price}${item.askingPrice === null ? "" : ` (asking ${item.askingPrice})`}${handoffLine(item)}`);
  const text = [summary, data.savings, ...lines, `Preview: ${previewUrl}`, data.nextStep].filter((line): line is string => line !== null).join("\n");
  return { ok: true, data, text, record: { planId: plan.id, summary: `plan_room answered ${status} with ${data.items.length} items, ${data.paypalTotal} through PayPal.` } };
}

export const createCheckoutInput = z.object({
  planId: z.uuid().describe("The planId plan_room returned in this session."),
});
export type CreateCheckoutInput = z.infer<typeof createCheckoutInput>;

export const createCheckoutOutput = z.object({
  planId: z.uuid(),
  paypalOrderId: z.string(),
  approvalUrl: z.url(),
  previewUrl: z.url(),
  total: z.string(),
  paymentMode: z.enum(["authorize_then_capture", "capture_at_checkout"]),
  whatHappens: z.string(),
  items: z.array(z.object({ title: z.string(), seller: z.string(), price: z.string() })),
  approveWithin: z.string(),
});
export type CreateCheckoutOutput = z.infer<typeof createCheckoutOutput>;

export interface PreparedOrder {
  paypalOrderId: string;
  created: boolean;
  approvalUrl: string | null;
  totalCents: number;
  paymentMode: PaymentMode;
  sellerCount: number;
  lines: { title: string; sellerName: string; amountCents: number }[];
}

export interface CreateCheckoutDeps {
  appUrl: string;
  /** The plan, only when this MCP session made it, with what PayPal holds once the student approved. */
  ownPlan(planId: string, buyerSession: string): Promise<{ id: string; running: boolean; hasUsedItems: boolean; held: { totalCents: number; settled: boolean } | null } | null>;
  /** Prepares the plan's PayPal order through the same code as the PayPal button, or answers why not. */
  prepare(planId: string): Promise<{ ok: true; order: PreparedOrder } | { ok: false; message: string }>;
}

const MODE_WORDS: Readonly<Record<PaymentMode, (total: string) => string>> = {
  authorize_then_capture: (total) => `After the student approves, PayPal holds ${total} and charges each item when the student checks it at handoff. Sellers are paid out then.`,
  capture_at_checkout: (total) => `After the student approves, PayPal takes ${total} and Roomover keeps it until the student checks each item at handoff, refunding anything turned down.`,
};

/** Prepares the PayPal order for a plan this MCP session made and returns the link the student approves it with. */
export async function createCheckout(deps: CreateCheckoutDeps, caller: McpCaller, input: CreateCheckoutInput): Promise<ToolOutcome<CreateCheckoutOutput>> {
  const plan = await deps.ownPlan(input.planId, caller.buyerSession);
  if (plan === null) return refuse("No plan with that ID belongs to this MCP session. Call plan_room first and use the planId it returns.");
  if (plan.held !== null) {
    const total = formatUsdShort(plan.held.totalCents);
    return refuse(
      plan.held.settled
        ? `The student already approved this room in PayPal and checked every item at handoff, so PayPal paid the sellers from the ${total}.`
        : `The student already approved this room in PayPal, so PayPal holds ${total} until the handoff, which runs in the browser that approved it.`,
      plan.id,
    );
  }
  if (plan.running) return refuse("The buyer agent is still working on this room. Call create_checkout again once plan_room reports it ready.", plan.id);
  if (!plan.hasUsedItems) return refuse("This room holds no used items, so there is nothing to pay for through PayPal.", plan.id);

  const prepared = await deps.prepare(plan.id);
  if (!prepared.ok) return refuse(prepared.message, plan.id);
  const { order } = prepared;
  if (order.approvalUrl === null) return refuse("PayPal did not return an approval link for the order. Nothing was charged. Try again in a moment.", plan.id);
  const total = formatUsdShort(order.totalCents);
  const previewUrl = absoluteUrl(deps.appUrl, previewPath(plan.id));
  const data: CreateCheckoutOutput = {
    planId: plan.id,
    paypalOrderId: order.paypalOrderId,
    approvalUrl: order.approvalUrl,
    previewUrl,
    total,
    paymentMode: order.paymentMode,
    whatHappens: `${MODE_WORDS[order.paymentMode](total)} Nothing moves until the student approves in PayPal.`,
    items: order.lines.map((line) => ({ title: line.title, seller: line.sellerName, price: formatUsdShort(line.amountCents) })),
    approveWithin: "PayPal keeps the approval link open for about 5 hours. After that, call create_checkout again for a fresh one.",
  };
  const students = order.sellerCount === 1 ? "1 student" : `${order.sellerCount} students`;
  const text = [
    `PayPal order ${order.paypalOrderId} for ${total} pays ${students} for ${order.lines.length} used ${order.lines.length === 1 ? "item" : "items"}.`,
    `Send the student this link to approve it in PayPal: ${order.approvalUrl}`,
    data.whatHappens,
    `After approving, PayPal brings the student back to ${previewUrl}.`,
  ].join("\n");
  return {
    ok: true,
    data,
    text,
    record: {
      planId: plan.id,
      summary: `create_checkout ${order.created ? "created" : "reused"} PayPal order ${order.paypalOrderId} for ${total} and returned its approval link.`,
      sentence: `${assistantName(caller.clientName)} asked for a PayPal approval link for ${total} over MCP. Nothing is charged until you approve in PayPal.`,
      paypal: { api: "Orders v2", id: order.paypalOrderId },
      detail: { totalCents: order.totalCents, paypalIdKind: "order" },
    },
  };
}
