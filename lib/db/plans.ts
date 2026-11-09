import { and, asc, desc, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";
import type { CatalogListing, EventDraft } from "@/lib/agents/buyer/context";
import { decideLimit, RunConflictError, RunLimitError, startOfUtcDay, type LimitCounts, type WindowCount } from "@/lib/agents/limits";
import { agentEventDetailSchema } from "@/lib/domain/agent-events";
import type { AgentName, AgentRunKind, AgentRunStatus, ClaudeMode, PlanStatus, RoomType } from "@/lib/domain/enums";
import { hallConstraintsSchema, type HallConstraint } from "@/lib/domain/hall-rules";
import { handoffWindow } from "@/lib/domain/handoff";
import { planLayoutSchema, type PlanLayout } from "@/lib/domain/layout";
import { listingColorsSchema, listingSpecsSchema } from "@/lib/domain/listing";
import { roomGeometrySchema, type RoomGeometry } from "@/lib/domain/room";
import type { ActivityEventView, PlanListing, RunView } from "@/lib/plan-view";
import type { Database } from "./client";
import { agentEvents, agentRuns, hallRules, halls, listings, plans, roomPresets, users } from "./schema";

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** A run still marked running after this long belongs to a process that stopped. */
const STALE_RUN_MS = 10 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface PresetWithRules {
  id: string;
  slug: string;
  name: string;
  roomType: RoomType;
  campus: string;
  hallName: string;
  widthMm: number;
  depthMm: number;
  ceilingHeightMm: number;
  geometry: RoomGeometry;
  ruleText: string;
  constraints: HallConstraint[];
}

export async function loadPresetsWithRules(db: Database): Promise<PresetWithRules[]> {
  const rows = await db
    .select({
      id: roomPresets.id,
      slug: roomPresets.slug,
      name: roomPresets.name,
      roomType: roomPresets.roomType,
      campus: halls.campus,
      hallName: halls.name,
      widthMm: roomPresets.widthMm,
      depthMm: roomPresets.depthMm,
      ceilingHeightMm: roomPresets.ceilingHeightMm,
      geometry: roomPresets.geometry,
      ruleText: hallRules.ruleText,
      constraints: hallRules.constraints,
    })
    .from(roomPresets)
    .innerJoin(halls, eq(roomPresets.hallId, halls.id))
    .innerJoin(hallRules, eq(hallRules.hallId, halls.id))
    .orderBy(asc(halls.name));
  return rows.map((row) => ({ ...row, geometry: roomGeometrySchema.parse(row.geometry), constraints: hallConstraintsSchema.parse(row.constraints) }));
}

const listingColumns = {
  id: listings.id,
  title: listings.title,
  description: listings.description,
  category: listings.category,
  placement: listings.placement,
  widthMm: listings.widthMm,
  depthMm: listings.depthMm,
  heightMm: listings.heightMm,
  specs: listings.specs,
  priceCents: listings.priceCents,
  retailReference: listings.retailReference,
  conditionReport: listings.conditionReport,
  color: listings.color,
  colors: listings.colors,
  styleTags: listings.styleTags,
  sellerName: users.displayName,
  handoffMode: listings.handoffMode,
  moveOutStartsAt: listings.moveOutStartsAt,
  moveOutEndsAt: listings.moveOutEndsAt,
  moveInStartsAt: listings.moveInStartsAt,
  moveInEndsAt: listings.moveInEndsAt,
};

type ListingRow = { [K in keyof typeof listingColumns]: (typeof listingColumns)[K]["_"]["data"] };

function toCatalogListing(row: ListingRow): CatalogListing {
  const { retailReference, conditionReport, specs, colors, handoffMode, moveOutStartsAt, moveOutEndsAt, moveInStartsAt, moveInEndsAt, ...rest } = row;
  return {
    ...rest,
    pickup: handoffWindow(handoffMode, { moveOutStartsAt, moveOutEndsAt, moveInStartsAt, moveInEndsAt }),
    specs: listingSpecsSchema.parse(specs),
    colors: colors.length === 0 ? [] : listingColorsSchema.parse(colors),
    newPriceCents: retailReference.newPriceCents,
    condition: conditionReport.grade,
  };
}

/** Every active listing on a campus, which is what the buyer agent may search and place. */
export async function loadCatalog(db: Database, campus: string): Promise<CatalogListing[]> {
  const rows = await db
    .select(listingColumns)
    .from(listings)
    .innerJoin(users, eq(listings.sellerId, users.id))
    .where(and(eq(listings.campus, campus), eq(listings.status, "active")))
    .orderBy(asc(listings.priceCents));
  return rows.map(toCatalogListing);
}

export async function countActiveListings(db: Database, campus: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(listings)
    .where(and(eq(listings.campus, campus), eq(listings.status, "active")));
  return row?.count ?? 0;
}

/** The listings a layout names, whatever their status, for the tags in the room. */
export async function loadPlanListings(db: Database, ids: readonly string[]): Promise<Map<string, PlanListing>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select(listingColumns).from(listings).innerJoin(users, eq(listings.sellerId, users.id)).where(inArray(listings.id, [...ids]));
  return new Map(
    rows.map((row) => {
      const listing = toCatalogListing(row);
      return [
        listing.id,
        {
          id: listing.id,
          title: listing.title,
          conditionGrade: listing.condition,
          priceCents: listing.priceCents,
          newPriceCents: listing.newPriceCents,
          sellerName: listing.sellerName,
          color: listing.color,
          colors: listing.colors,
        },
      ];
    }),
  );
}

export interface PlanRow {
  id: string;
  buyerId: string;
  buyerName: string;
  sessionId: string | null;
  roomPresetId: string;
  roomNumber: string | null;
  budgetCents: number;
  stylePrompt: string;
  layout: PlanLayout;
  status: PlanStatus;
}

const planColumns = {
  id: plans.id,
  buyerId: plans.buyerId,
  buyerName: users.displayName,
  sessionId: plans.sessionId,
  roomPresetId: plans.roomPresetId,
  roomNumber: plans.roomNumber,
  budgetCents: plans.budgetCents,
  stylePrompt: plans.stylePrompt,
  layout: plans.layout,
  status: plans.status,
};

const toPlanRow = (row: Omit<PlanRow, "layout"> & { layout: unknown }): PlanRow => ({ ...row, layout: planLayoutSchema.parse(row.layout) });

export async function createPlan(
  db: Database,
  input: { buyerId: string; sessionId: string; roomPresetId: string; roomNumber: string | null; budgetCents: number; stylePrompt: string },
): Promise<string> {
  const [row] = await db.insert(plans).values({ ...input, status: "draft" }).returning({ id: plans.id });
  return row.id;
}

/** A plan, only when it belongs to the session asking for it. */
export async function loadSessionPlan(db: Database, planId: string, sessionId: string): Promise<PlanRow | null> {
  const [row] = await db
    .select(planColumns)
    .from(plans)
    .innerJoin(users, eq(plans.buyerId, users.id))
    .where(and(eq(plans.id, planId), eq(plans.sessionId, sessionId)));
  return row === undefined ? null : toPlanRow(row);
}

export async function latestSessionPlan(db: Database, sessionId: string): Promise<PlanRow | null> {
  const [row] = await db
    .select(planColumns)
    .from(plans)
    .innerJoin(users, eq(plans.buyerId, users.id))
    .where(eq(plans.sessionId, sessionId))
    .orderBy(desc(plans.createdAt))
    .limit(1);
  return row === undefined ? null : toPlanRow(row);
}

export async function savePlanLayout(db: Database | Transaction, planId: string, layout: PlanLayout): Promise<void> {
  await db.update(plans).set({ layout: planLayoutSchema.parse(layout) }).where(eq(plans.id, planId));
}

export async function setPlanStatus(db: Database | Transaction, planId: string, status: PlanStatus): Promise<void> {
  await db.update(plans).set({ status }).where(eq(plans.id, planId));
}

export interface RunRow {
  id: string;
  planId: string;
  kind: AgentRunKind;
  status: AgentRunStatus;
  request: string | null;
  claudeMode: ClaudeMode;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

const runColumns = {
  id: agentRuns.id,
  planId: agentRuns.planId,
  kind: agentRuns.kind,
  status: agentRuns.status,
  request: agentRuns.request,
  claudeMode: agentRuns.claudeMode,
  error: agentRuns.error,
  startedAt: agentRuns.startedAt,
  finishedAt: agentRuns.finishedAt,
};

export function runView(run: RunRow): RunView {
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    request: run.request,
    error: run.error,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

export async function latestRun(db: Database, planId: string): Promise<RunRow | null> {
  const [row] = await db.select(runColumns).from(agentRuns).where(eq(agentRuns.planId, planId)).orderBy(desc(agentRuns.startedAt)).limit(1);
  return row ?? null;
}

async function windowCount(tx: Transaction, column: typeof agentRuns.sessionId | typeof agentRuns.clientHash, value: string, since: Date): Promise<WindowCount> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int`, oldest: sql<Date | null>`min(${agentRuns.startedAt})` })
    .from(agentRuns)
    .where(and(eq(column, value), eq(agentRuns.claudeMode, "live"), gte(agentRuns.startedAt, since)));
  return { count: row?.count ?? 0, oldest: row?.oldest === null || row?.oldest === undefined ? null : new Date(row.oldest) };
}

/** Live Claude calls since midnight UTC, from buyer agent runs and verifier comparisons together. */
export async function claudeCallsToday(db: Database | Transaction, now: Date): Promise<number> {
  const since = startOfUtcDay(now);
  const [runs] = await db
    .select({ calls: sql<number>`coalesce(sum(${agentRuns.claudeCalls}), 0)::int` })
    .from(agentRuns)
    .where(and(eq(agentRuns.claudeMode, "live"), gte(agentRuns.startedAt, since)));
  const [comparisons] = await db
    .select({ calls: sql<number>`coalesce(sum((${agentEvents.detail}->>'claudeCalls')::int), 0)::int` })
    .from(agentEvents)
    .where(and(eq(agentEvents.agent, "verifier"), gte(agentEvents.createdAt, since)));
  return (runs?.calls ?? 0) + (comparisons?.calls ?? 0);
}

/**
 * Starts a run in one transaction. The plan row lock lets one run at a time
 * work on a plan, and the limits are counted under the same lock, so two
 * quick presses cannot both pass. A run left running by a stopped process
 * is closed as failed first.
 */
export async function startRun(
  db: Database,
  input: { planId: string; kind: AgentRunKind; request: string | null; sessionId: string; clientHash: string; claudeMode: ClaudeMode; now: Date },
): Promise<RunRow> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from ${plans} where ${plans.id} = ${input.planId} for update`);
    await tx
      .update(agentRuns)
      .set({ status: "failed", error: "The run stopped before it finished.", finishedAt: input.now })
      .where(and(eq(agentRuns.planId, input.planId), eq(agentRuns.status, "running"), lt(agentRuns.startedAt, new Date(input.now.getTime() - STALE_RUN_MS))));
    const [running] = await tx.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.planId, input.planId), eq(agentRuns.status, "running")));
    if (running !== undefined) throw new RunConflictError();

    if (input.claudeMode === "live") {
      // One advisory lock for all limit checks, so concurrent starts from different plans count each other.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('roomover.agent_run_limits'))`);
      const since = new Date(input.now.getTime() - HOUR_MS);
      const counts: LimitCounts = {
        session: await windowCount(tx, agentRuns.sessionId, input.sessionId, since),
        client: await windowCount(tx, agentRuns.clientHash, input.clientHash, since),
        claudeCallsToday: await claudeCallsToday(tx, input.now),
      };
      const decision = decideLimit(counts, input.kind, input.now);
      if (!decision.allowed) throw new RunLimitError(decision);
    }

    const [run] = await tx
      .insert(agentRuns)
      .values({
        planId: input.planId,
        kind: input.kind,
        request: input.request,
        sessionId: input.sessionId,
        clientHash: input.clientHash,
        claudeMode: input.claudeMode,
        startedAt: input.now,
      })
      .returning(runColumns);
    await setPlanStatus(tx, input.planId, "planning");
    return run;
  });
}

export async function addRunUsage(
  db: Database,
  runId: string,
  usage: { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number },
): Promise<void> {
  await db
    .update(agentRuns)
    .set({
      claudeCalls: sql`${agentRuns.claudeCalls} + 1`,
      inputTokens: sql`${agentRuns.inputTokens} + ${usage.inputTokens}`,
      outputTokens: sql`${agentRuns.outputTokens} + ${usage.outputTokens}`,
      cacheWriteTokens: sql`${agentRuns.cacheWriteTokens} + ${usage.cacheWriteTokens}`,
      cacheReadTokens: sql`${agentRuns.cacheReadTokens} + ${usage.cacheReadTokens}`,
    })
    .where(eq(agentRuns.id, runId));
}

export async function markFirstItem(db: Database, runId: string, at: Date): Promise<void> {
  await db.update(agentRuns).set({ firstItemAt: at }).where(and(eq(agentRuns.id, runId), sql`${agentRuns.firstItemAt} is null`));
}

export async function finishRun(db: Database, runId: string, outcome: { status: "succeeded" } | { status: "failed"; error: string }, at: Date): Promise<RunRow> {
  const [row] = await db
    .update(agentRuns)
    .set({ status: outcome.status, error: outcome.status === "failed" ? outcome.error : null, finishedAt: at })
    .where(eq(agentRuns.id, runId))
    .returning(runColumns);
  return row;
}

const eventColumns = {
  seq: agentEvents.seq,
  runId: agentEvents.runId,
  at: agentEvents.createdAt,
  agent: agentEvents.agent,
  tool: agentEvents.tool,
  summary: agentEvents.summary,
  sentence: agentEvents.sentence,
  blocked: agentEvents.blocked,
  detail: agentEvents.detail,
  paypalApi: agentEvents.paypalApi,
  paypalId: agentEvents.paypalId,
};

type EventRow = Omit<ActivityEventView, "at" | "detail" | "paypal"> & { at: Date; detail: unknown; paypalApi: string | null; paypalId: string | null };

const toEventView = ({ paypalApi, paypalId, ...row }: EventRow): ActivityEventView => ({
  ...row,
  at: row.at.toISOString(),
  detail: agentEventDetailSchema.parse(row.detail),
  paypal: paypalApi === null || paypalId === null ? null : { api: paypalApi, id: paypalId },
});

/** Writes activity lines. Checkout steps pass the order they belong to, and their run ID is the order's ID. */
export async function insertEvents(
  db: Database | Transaction,
  input: { runId: string; planId: string; orderId?: string; agent: AgentName; drafts: readonly EventDraft[] },
): Promise<ActivityEventView[]> {
  if (input.drafts.length === 0) return [];
  const rows = await db
    .insert(agentEvents)
    .values(
      input.drafts.map((draft) => ({
        runId: input.runId,
        planId: input.planId,
        agent: input.agent,
        tool: draft.tool,
        summary: draft.summary,
        sentence: draft.sentence ?? null,
        blocked: draft.blocked ?? false,
        detail: agentEventDetailSchema.parse(draft.detail ?? {}),
        paypalApi: draft.paypal?.api ?? null,
        paypalId: draft.paypal?.id ?? null,
        orderId: input.orderId ?? null,
      })),
    )
    .returning(eventColumns);
  return rows.map(toEventView).sort((a, b) => a.seq - b.seq);
}

/** Every activity line of one order, oldest first. */
export async function orderEventViews(db: Database | Transaction, orderId: string): Promise<ActivityEventView[]> {
  const rows = await db.select(eventColumns).from(agentEvents).where(eq(agentEvents.orderId, orderId)).orderBy(asc(agentEvents.seq));
  return rows.map(toEventView);
}

export async function eventsAfter(db: Database, planId: string, afterSeq: number): Promise<ActivityEventView[]> {
  const rows = await db.select(eventColumns).from(agentEvents).where(and(eq(agentEvents.planId, planId), gt(agentEvents.seq, afterSeq))).orderBy(asc(agentEvents.seq));
  return rows.map(toEventView);
}
