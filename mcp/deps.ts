import { eq } from "drizzle-orm";
import { publish, subscribe } from "@/lib/agents/bus";
import { loadPlanView, roomLabel, startBuyerRun } from "@/lib/agents/buyer/run";
import type { CatalogListing } from "@/lib/agents/buyer/context";
import { RunConflictError, RunLimitError } from "@/lib/agents/limits";
import { approvalUrlFor, prepareCheckout } from "@/lib/checkout/prepare";
import { readConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { countSessionPlans, createPlan, insertEvents, latestRun, loadCatalog, loadListingExtras, loadPresetsWithRules, loadSessionPlan, loadSharedPlan, type PresetWithRules } from "@/lib/db/plans";
import { plans } from "@/lib/db/schema";
import { DEMO_BUYER_ID, DEMO_ROOM } from "@/lib/demo";
import { CheckoutRefused } from "@/lib/domain/checkout";
import { MCP_LIMITS, type McpToolName } from "@/lib/domain/mcp";
import { PayPalApiError } from "@/lib/paypal/errors";
import { paypalSdk } from "@/lib/paypal/server-sdk/client";
import { CAMPUS, UNIVERSITY } from "@/scripts/seed/campus";
import type { ListingExtras, SearchScope } from "./catalog";
import type { CreateCheckoutDeps, McpRecord, PlanRoomDeps } from "./shopping";

/** What the MCP tools read and write, so tests can hand them fakes. */
export interface McpDeps {
  searchScope(roomPresetSlug: string | undefined): Promise<SearchScope & { roomLabel: string | null }>;
  catalog(): Promise<{ catalog: CatalogListing[]; extras: Map<string, ListingExtras> }>;
  presets(): Promise<PresetWithRules[]>;
  demoRoom(presets: readonly PresetWithRules[]): { presetSlug: string; label: string; student: string };
  planRoom(logRunId: string): PlanRoomDeps;
  createCheckout(): CreateCheckoutDeps;
  recordCall(logRunId: string, record: McpRecord, meta: { tool: McpToolName; client: string; latencyMs: number; blocked: boolean }): Promise<void>;
}

const POLL_MS = 2_000;
const roomNumberFor = (preset: Pick<PresetWithRules, "slug">) => (preset.slug === DEMO_ROOM.presetSlug ? DEMO_ROOM.roomNumber : null);

/** Waits until the run stops, from the plan bus with a Postgres read every 2 s in case a message went by unseen. */
function waitForRun(planId: string, runId: string, onSentence: (sentence: string) => void, signal: AbortSignal): Promise<"finished" | "timeout"> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: "finished" | "timeout") => {
      if (settled) return;
      settled = true;
      unsubscribe();
      clearInterval(poll);
      clearTimeout(limit);
      signal.removeEventListener("abort", aborted);
      resolve(outcome);
    };
    const unsubscribe = subscribe(planId, (message) => {
      if (message.type === "event" && message.event.runId === runId && message.event.sentence !== null) onSentence(message.event.sentence);
      if (message.type === "plan" && message.plan.run?.id === runId && message.plan.run.status !== "running") finish("finished");
    });
    const poll = setInterval(() => {
      void latestRun(getDb(), planId)
        .then((run) => run !== null && run.id === runId && run.status !== "running" && finish("finished"))
        .catch(() => undefined);
    }, POLL_MS);
    const limit = setTimeout(() => finish("timeout"), MCP_LIMITS.planWaitMs);
    // A client that cancels stops waiting. The run keeps going and the preview link shows it.
    const aborted = () => finish("timeout");
    signal.addEventListener("abort", aborted, { once: true });
  });
}

/** The tools wired to Postgres, the buyer agent, and the PayPal Server SDK. */
export function liveMcpDeps(): McpDeps {
  const db = getDb();
  const appUrl = () => readConfig(["APP_URL"]).APP_URL;
  const presets = () => loadPresetsWithRules(db);

  return {
    async searchScope(roomPresetSlug) {
      const preset = roomPresetSlug === undefined ? undefined : (await presets()).find((candidate) => candidate.slug === roomPresetSlug);
      const roomNumber = preset === undefined ? null : roomNumberFor(preset);
      return {
        campusSlug: CAMPUS,
        campusName: UNIVERSITY,
        room: preset === undefined ? null : { roomPresetId: preset.id, roomNumber, hallName: preset.hallName, constraints: preset.constraints },
        roomLabel: preset === undefined ? null : roomLabel(preset, roomNumber),
        appUrl: appUrl(),
      };
    },
    async catalog() {
      const catalog = await loadCatalog(db, CAMPUS);
      return { catalog, extras: await loadListingExtras(db, catalog.map((listing) => listing.id)) };
    },
    presets,
    demoRoom(all) {
      const preset = all.find((candidate) => candidate.slug === DEMO_ROOM.presetSlug);
      return { presetSlug: DEMO_ROOM.presetSlug, label: preset === undefined ? `Room ${DEMO_ROOM.roomNumber}` : roomLabel(preset, DEMO_ROOM.roomNumber), student: "Jordan Ellis, the demo student," };
    },
    planRoom(logRunId) {
      return {
        now: () => new Date(),
        appUrl: appUrl(),
        presets,
        roomNumberFor,
        recentPlans: (buyerSession, since) => countSessionPlans(db, buyerSession, since),
        async createPlan(input) {
          const id = await createPlan(db, {
            buyerId: DEMO_BUYER_ID,
            sessionId: input.buyerSession,
            roomPresetId: input.preset.id,
            roomNumber: input.roomNumber,
            budgetCents: input.budgetCents,
            stylePrompt: input.prompt,
          });
          return { id, roomLabel: roomLabel(input.preset, input.roomNumber) };
        },
        async deletePlan(planId) {
          await db.delete(plans).where(eq(plans.id, planId));
        },
        async recordRequest(planId, record, caller) {
          const events = await insertEvents(db, {
            runId: logRunId,
            planId,
            agent: "platform",
            drafts: [{ tool: "mcp_plan_room", summary: record.summary, sentence: record.sentence, detail: { ...record.detail, mcp: { tool: "plan_room", client: caller.clientName ?? "unnamed" } } }],
          });
          for (const event of events) publish(planId, { type: "event", event });
        },
        async startRun(planId, preset, caller) {
          const plan = await loadSessionPlan(db, planId, caller.buyerSession);
          if (plan === null) throw new Error(`Plan ${planId} vanished after insert.`);
          return startBuyerRun({ plan, preset, kind: "plan", request: null, sessionId: caller.buyerSession, clientHash: caller.clientHash });
        },
        refusalOf(error) {
          if (error instanceof RunLimitError) return `${error.message} Try again after ${error.decision.retryAt.toISOString()}.`;
          if (error instanceof RunConflictError) return error.message;
          return null;
        },
        waitForRun,
        async view(planId, preset) {
          const plan = await loadSharedPlan(db, planId);
          if (plan === null) throw new Error(`Plan ${planId} is missing.`);
          return loadPlanView(db, plan, preset, await latestRun(db, planId));
        },
      };
    },
    createCheckout() {
      return {
        appUrl: appUrl(),
        async ownPlan(planId, buyerSession) {
          const plan = await loadSessionPlan(db, planId, buyerSession);
          if (plan === null) return null;
          return { id: plan.id, running: (await latestRun(db, planId))?.status === "running", hasUsedItems: plan.layout.items.some((item) => item.source === "listing") };
        },
        async prepare(planId) {
          const plan = await loadSharedPlan(db, planId);
          if (plan === null) return { ok: false, message: "That plan is gone. Plan the room again with plan_room." };
          const sdk = paypalSdk();
          try {
            const prepared = await prepareCheckout({ db, sdk, appUrl: appUrl(), now: new Date() }, plan);
            const { checkout } = prepared;
            return {
              ok: true,
              order: {
                paypalOrderId: prepared.paypalOrderId,
                created: prepared.created,
                approvalUrl: await approvalUrlFor(sdk, prepared),
                totalCents: checkout.totalCents,
                paymentMode: checkout.paymentMode,
                sellerCount: checkout.sellerCount,
                lines: checkout.lines.map((line) => ({ title: line.title, sellerName: line.sellerName, amountCents: line.amountCents })),
              },
            };
          } catch (error) {
            if (error instanceof CheckoutRefused) return { ok: false, message: error.message };
            if (error instanceof PayPalApiError) {
              console.error("mcp create_checkout: PayPal did not create the order", { planId, status: error.status, debugId: error.debugId });
              return { ok: false, message: "PayPal did not create the order. Nothing was charged. Try again in a moment." };
            }
            throw error;
          }
        },
      };
    },
    async recordCall(logRunId, record, meta) {
      const events = await insertEvents(db, {
        runId: logRunId,
        planId: record.planId,
        agent: "platform",
        drafts: [
          {
            tool: `mcp_${meta.tool}`,
            summary: record.summary,
            sentence: record.sentence,
            blocked: meta.blocked,
            detail: { ...record.detail, mcp: { tool: meta.tool, client: meta.client.slice(0, 80) }, latencyMs: meta.latencyMs },
            paypal: record.paypal,
          },
        ],
      });
      if (record.planId !== null) for (const event of events) publish(record.planId, { type: "event", event });
    },
  };
}
