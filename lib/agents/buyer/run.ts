import { publish } from "@/lib/agents/bus";
import { prepareCheckout } from "@/lib/checkout/prepare";
import { readConfig } from "@/lib/config";
import { RUN_LIMITS, RunStopped } from "@/lib/agents/limits";
import { getDb, type Database } from "@/lib/db/client";
import { currentOrder, type OrderWithLines } from "@/lib/db/orders";
import {
  addRunUsage,
  claudeCallsToday,
  finishRun,
  insertEvents,
  loadCatalog,
  loadPlanListings,
  loadSessionPlan,
  markFirstItem,
  runView,
  savePlanLayout,
  setPlanStatus,
  startRun,
  type PlanRow,
  type PresetWithRules,
  type RunRow,
} from "@/lib/db/plans";
import { CheckoutRefused } from "@/lib/domain/checkout";
import { EGRESS_PATH_MM } from "@/lib/domain/egress";
import type { AgentRunKind, ClaudeMode } from "@/lib/domain/enums";
import type { PlanLayout } from "@/lib/domain/layout";
import { formatUsdShort } from "@/lib/format";
import { PayPalApiError } from "@/lib/paypal/errors";
import { paypalSdk } from "@/lib/paypal/server-sdk/client";
import { buildPlanView, type CheckoutView, type PlanListing, type PlanMeta, type PlanView } from "@/lib/plan-view";
import { claudeMode, transportFor } from "./claude";
import { planTotalCents, type BuyerContext, type CatalogListing, type CheckoutPort, type EventDraft } from "./context";
import { runBuyerLoop } from "./loop";

/** Names the room for the student, such as Harbor Hall 214. */
export function roomLabel(preset: Pick<PresetWithRules, "hallName" | "name">, roomNumber: string | null): string {
  return roomNumber === null ? preset.name : `${preset.hallName} ${roomNumber}`;
}

export function planMeta(plan: PlanRow, preset: PresetWithRules): PlanMeta {
  return {
    id: plan.id,
    status: plan.status,
    presetSlug: preset.slug,
    roomLabel: roomLabel(preset, plan.roomNumber),
    budgetCents: plan.budgetCents,
    stylePrompt: plan.stylePrompt,
  };
}

const toPlanListing = (listing: CatalogListing): PlanListing => ({
  id: listing.id,
  title: listing.title,
  conditionGrade: listing.condition,
  priceCents: listing.priceCents,
  newPriceCents: listing.newPriceCents,
  sellerName: listing.sellerName,
  color: listing.color,
  colors: listing.colors,
});

export function checkoutView(order: OrderWithLines | null): CheckoutView | null {
  if (order === null) return null;
  return {
    status: order.status,
    paymentMode: order.paymentMode,
    totalCents: order.totalCents,
    sellerCount: new Set(order.lines.map((line) => line.sellerId)).size,
    paypalOrderId: order.paypalOrderId,
    authorizationId: order.paypalAuthorizationId,
    captureId: order.paypalCaptureId,
  };
}

/** The snapshot for a plan as it stands in Postgres, for the page and for new streams. */
export async function loadPlanView(db: Database, plan: PlanRow, preset: PresetWithRules, run: RunRow | null): Promise<PlanView> {
  const ids = plan.layout.items.flatMap((item) => (item.source === "listing" ? [item.listingId] : []));
  const [listings, order] = await Promise.all([loadPlanListings(db, ids), currentOrder(db, plan.id)]);
  return buildPlanView(planMeta(plan, preset), plan.layout, listings, run === null ? null : runView(run), checkoutView(order));
}

/** create_checkout as a run sees it, backed by Postgres and the Server SDK. */
function checkoutPort(db: Database, plan: PlanRow): CheckoutPort {
  return {
    async prepare(layout) {
      try {
        const prepared = await prepareCheckout({ db, sdk: paypalSdk(), appUrl: readConfig(["APP_URL"]).APP_URL, now: new Date() }, { id: plan.id, buyerId: plan.buyerId, layout });
        return {
          ok: true,
          created: prepared.created,
          paypalOrderId: prepared.paypalOrderId,
          totalCents: prepared.checkout.totalCents,
          itemCount: prepared.checkout.lines.length,
          sellerCount: prepared.checkout.sellerCount,
          paymentMode: prepared.checkout.paymentMode,
        };
      } catch (error) {
        if (error instanceof CheckoutRefused) return { ok: false, problem: error.message };
        if (error instanceof PayPalApiError) {
          console.error("create_checkout: PayPal refused the order", { planId: plan.id, status: error.status, debugId: error.debugId });
          return { ok: false, problem: "PayPal did not create the order this time. The student can still pay from the panel, which prepares it again." };
        }
        throw error;
      }
    },
  };
}

function buildContext(plan: PlanRow, preset: PresetWithRules, catalog: CatalogListing[]): BuyerContext {
  const egress = preset.constraints.find((constraint) => constraint.kind === "egress_clearance");
  return {
    hallName: preset.hallName,
    roomLabel: roomLabel(preset, plan.roomNumber),
    presetName: preset.name,
    room: {
      widthMm: preset.widthMm,
      depthMm: preset.depthMm,
      ceilingHeightMm: preset.ceilingHeightMm,
      geometry: preset.geometry,
      egressPathMm: egress?.kind === "egress_clearance" ? egress.minPathWidthMm : EGRESS_PATH_MM,
    },
    ruleText: preset.ruleText,
    constraints: preset.constraints,
    budgetCents: plan.budgetCents,
    buyerName: plan.buyerName,
    stylePrompt: plan.stylePrompt,
    catalog: new Map(catalog.map((listing) => [listing.id, listing])),
    layout: plan.layout,
    announcedSkips: new Set(),
    now: new Date(),
  };
}


function finishSentence(kind: AgentRunKind, context: BuyerContext, unchanged: boolean): string {
  if (kind === "edit" && unchanged) return "The agent could not make that change, so the room stays as it was.";
  const listingItems = context.layout.items.flatMap((item) => (item.source === "listing" ? [item.listingId] : []));
  const sellers = new Set(listingItems.map((id) => context.catalog.get(id)?.sellerName));
  const total = formatUsdShort(planTotalCents(context.layout, context.catalog));
  if (kind === "edit") return `Your room is updated. ${listingItems.length} items, ${total} of ${formatUsdShort(context.budgetCents)}.`;
  if (listingItems.length === 0) return "Nothing fit your room and budget this time. Try a larger budget or different words.";
  const items = listingItems.length === 1 ? "1 item" : `${listingItems.length} items`;
  const students = sellers.size === 1 ? "1 student" : `${sellers.size} students`;
  return `Your room is ready. ${items} from ${students}.`;
}

export interface StartRunInput {
  plan: PlanRow;
  preset: PresetWithRules;
  kind: AgentRunKind;
  request: string | null;
  sessionId: string;
  clientHash: string;
}

/**
 * Starts a buyer agent run and returns once it is recorded. The run itself
 * keeps going after the response, writing each step to Postgres and to any
 * open event stream for the plan.
 */
export async function startBuyerRun(input: StartRunInput): Promise<RunRow> {
  const db = getDb();
  const mode = claudeMode();
  const run = await startRun(db, {
    planId: input.plan.id,
    kind: input.kind,
    request: input.request,
    sessionId: input.sessionId,
    clientHash: input.clientHash,
    claudeMode: mode,
    now: new Date(),
  });
  executeRun(db, input, run, mode).catch(async (error: unknown) => {
    console.error("buyer agent run could not finish", { runId: run.id, error: error instanceof Error ? error.name : "unknown" });
    await finishRun(db, run.id, { status: "failed", error: "The buyer agent hit an unexpected error." }, new Date()).catch(() => undefined);
    await setPlanStatus(db, input.plan.id, input.plan.layout.items.length > 0 ? "ready" : "draft").catch(() => undefined);
  });
  return run;
}

async function executeRun(db: Database, input: StartRunInput, run: RunRow, mode: ClaudeMode): Promise<void> {
  const { preset, kind } = input;
  // The run lock is held now, so this read sees every hand edit saved before the run started.
  const plan = (await loadSessionPlan(db, input.plan.id, input.sessionId)) ?? input.plan;
  const catalog = await loadCatalog(db, preset.campus);
  const context: BuyerContext = { ...buildContext(plan, preset, catalog), checkout: checkoutPort(db, plan) };
  const meta = planMeta({ ...plan, status: "planning" }, preset);
  const listings = new Map<string, PlanListing>(catalog.map((listing) => [listing.id, toPlanListing(listing)]));
  // Items placed before this run keep their tags even if their listings left the catalog.
  for (const [id, listing] of await loadPlanListings(db, plan.layout.items.flatMap((item) => (item.source === "listing" ? [item.listingId] : [])))) {
    if (!listings.has(id)) listings.set(id, listing);
  }
  let current: RunRow = run;
  const snapshot = (layout: PlanLayout, status = meta.status) => publish(plan.id, { type: "plan", plan: buildPlanView({ ...meta, status }, layout, listings, runView(current)) });

  const record = async (drafts: EventDraft[]) => {
    const events = await insertEvents(db, { runId: run.id, planId: plan.id, agent: "buyer", drafts });
    for (const event of events) publish(plan.id, { type: "event", event });
    if (drafts.some((draft) => draft.tool === "place_item" && draft.blocked !== true)) await markFirstItem(db, run.id, new Date());
  };

  let outcome: { status: "succeeded" } | { status: "failed"; error: string };
  try {
    snapshot(context.layout);
    // A plan run's first sentences come from its opening reads, which follow at once.
    await record([{ tool: "run_started", summary: `${kind === "edit" ? "Edit" : "Plan"} run ${run.id} started with ${catalog.length} active listings.`, sentence: kind === "edit" ? "Working on your change." : undefined }]);
    const { transport } = await transportFor(kind);
    const result = await runBuyerLoop({
      transport,
      context,
      kind,
      request: input.request ?? undefined,
      hooks: {
        async beforeCall() {
          if (mode === "live" && (await claudeCallsToday(db, new Date())) >= RUN_LIMITS.claudeCallsPerDay) {
            throw new RunStopped("The demo used today's allowance of Claude calls. Items already placed stay in your room.");
          }
        },
        // A replayed reply spent nothing, so fixture runs record the call and no tokens.
        afterCall: (usage) => addRunUsage(db, run.id, mode === "live" ? usage : { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 }),
        onEvents: record,
        async onLayout(layout) {
          await savePlanLayout(db, plan.id, layout);
          snapshot(layout);
        },
      },
    });
    if (result.status === "succeeded") {
      const unchanged = JSON.stringify(context.layout) === JSON.stringify(plan.layout);
      await record([{ tool: "run_finished", summary: result.summary, sentence: finishSentence(kind, context, unchanged) }]);
      outcome = { status: "succeeded" };
    } else {
      outcome = result;
    }
  } catch (error) {
    console.error("buyer agent run failed", { runId: run.id, error: error instanceof Error ? error.name : "unknown" });
    outcome = { status: "failed", error: error instanceof RunStopped ? error.message : "The buyer agent hit an unexpected error. Items already placed stay in your room." };
  }

  if (outcome.status === "failed") {
    await record([{ tool: "run_failed", blocked: true, summary: outcome.error, sentence: `The buyer agent stopped. ${outcome.error}` }]).catch(() => undefined);
  }
  const status = context.layout.items.length > 0 ? "ready" : "draft";
  current = await finishRun(db, run.id, outcome, new Date());
  await setPlanStatus(db, plan.id, status);
  snapshot(context.layout, status);
}
