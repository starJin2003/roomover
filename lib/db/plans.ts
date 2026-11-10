import { and, asc, desc, eq, gt, gte, inArray, like, lt, or, sql } from "drizzle-orm";
import type { CatalogListing, EventDraft } from "@/lib/agents/buyer/context";
import { decideLimit, decideMcpRunLimit, RunConflictError, RunLimitError, startOfUtcDay, type LimitCounts, type LimitDecision, type WindowCount } from "@/lib/agents/limits";
import { agentEventDetailSchema } from "@/lib/domain/agent-events";
import type { AgentName, AgentRunKind, AgentRunStatus, ClaudeMode, HandoffMode, PlanStatus, RoomType } from "@/lib/domain/enums";
import { hallConstraintsSchema, type HallConstraint } from "@/lib/domain/hall-rules";
import { handoffWindow } from "@/lib/domain/handoff";
import { planLayoutSchema, type PlanLayout } from "@/lib/domain/layout";
import { listingColorsSchema, listingSpecsSchema } from "@/lib/domain/listing";
import { isMcpSession, MCP_SESSION_TAG, planClaimStep, type ClaimStep, type PlanClaim } from "@/lib/domain/mcp";
import { roomGeometrySchema, type RoomGeometry } from "@/lib/domain/room";
import type { ActivityEventView, PlanListing, RunView } from "@/lib/plan-view";
import type { Database } from "./client";
import { agentEvents, agentRuns, hallRules, halls, listingDrafts, listings, plans, retailReferences, roomPresets, users } from "./schema";

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
  sellerId: listings.sellerId,
  title: listings.title,
  description: listings.description,
  category: listings.category,
  placement: listings.placement,
  widthMm: listings.widthMm,
  depthMm: listings.depthMm,
  heightMm: listings.heightMm,
  specs: listings.specs,
  priceCents: listings.priceCents,
  floorPriceCents: listings.floorPriceCents,
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
  roomPresetId: listings.roomPresetId,
  roomNumber: listings.roomNumber,
};

type Column<K extends keyof typeof listingColumns> = (typeof listingColumns)[K]["_"];
type ListingRow = { [K in keyof typeof listingColumns]: Column<K>["notNull"] extends true ? Column<K>["data"] : Column<K>["data"] | null };

function toCatalogListing(row: ListingRow): CatalogListing {
  const { retailReference, conditionReport, specs, colors, handoffMode, moveOutStartsAt, moveOutEndsAt, moveInStartsAt, moveInEndsAt, roomPresetId, roomNumber, ...rest } = row;
  const matched = retailReference.source === "channel3";
  return {
    ...rest,
    pickup: handoffWindow(handoffMode, { moveOutStartsAt, moveOutEndsAt, moveInStartsAt, moveInEndsAt }),
    sameRoom: handoffMode === "same_room" && roomPresetId !== null && roomNumber !== null ? { roomPresetId, roomNumber } : null,
    specs: listingSpecsSchema.parse(specs),
    colors: colors.length === 0 ? [] : listingColorsSchema.parse(colors),
    newPriceCents: retailReference.newPriceCents,
    retailProductName: retailReference.productName,
    matchedRetail: matched
      ? { productName: retailReference.productName, newPriceCents: retailReference.newPriceCents, url: retailReference.url ?? null, retailer: / at ([a-z0-9.-]+)\.$/i.exec(retailReference.sourceNote)?.[1] ?? null }
      : null,
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

/** How each listing is handed over and its first photo, which the MCP search shows next to the catalog's facts. */
export async function loadListingExtras(db: Database, ids: readonly string[]): Promise<Map<string, { handoffMode: HandoffMode; photoSrc: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: listings.id, handoffMode: listings.handoffMode, photos: listings.photos }).from(listings).where(inArray(listings.id, [...ids]));
  return new Map(rows.map((row) => [row.id, { handoffMode: row.handoffMode, photoSrc: row.photos[0]?.src ?? "" }]));
}

export async function countActiveListings(db: Database, campus: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(listings)
    .where(and(eq(listings.campus, campus), eq(listings.status, "active")));
  return row?.count ?? 0;
}

/** The listings a layout names, whatever their status, for the tags in the room, with the new price Channel3 found for each. */
export async function loadPlanListings(db: Database, ids: readonly string[]): Promise<Map<string, PlanListing>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ ...listingColumns, channel3NewCents: retailReferences.newPriceCents })
    .from(listings)
    .innerJoin(users, eq(listings.sellerId, users.id))
    .leftJoin(retailReferences, eq(retailReferences.listingId, listings.id))
    .where(inArray(listings.id, [...ids]));
  return new Map(
    rows.map((row) => {
      const { channel3NewCents, ...columns } = row;
      const listing = toCatalogListing(columns);
      return [
        listing.id,
        {
          id: listing.id,
          title: listing.title,
          conditionGrade: listing.condition,
          priceCents: listing.priceCents,
          channel3NewCents,
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
  /** The MCP buyer session that planned the room, which makes the plan open to its preview link. */
  mcpSessionId: string | null;
  claimedAt: Date | null;
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
  mcpSessionId: plans.mcpSessionId,
  claimedAt: plans.claimedAt,
  roomPresetId: plans.roomPresetId,
  roomNumber: plans.roomNumber,
  budgetCents: plans.budgetCents,
  stylePrompt: plans.stylePrompt,
  layout: plans.layout,
  status: plans.status,
};

const toPlanRow = (row: Omit<PlanRow, "layout"> & { layout: unknown }): PlanRow => ({
  ...row,
  mcpSessionId: row.mcpSessionId ?? (isMcpSession(row.sessionId) ? row.sessionId : null),
  layout: planLayoutSchema.parse(row.layout),
});

export async function createPlan(
  db: Database,
  input: { buyerId: string; sessionId: string; roomPresetId: string; roomNumber: string | null; budgetCents: number; stylePrompt: string },
): Promise<string> {
  const [row] = await db
    .insert(plans)
    .values({ ...input, mcpSessionId: isMcpSession(input.sessionId) ? input.sessionId : null, status: "draft" })
    .returning({ id: plans.id });
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

/** A plan an MCP session made, which anyone holding its preview link may see, and pay for until a browser claims it. */
export async function loadSharedPlan(db: Database, planId: string): Promise<PlanRow | null> {
  const [row] = await db
    .select(planColumns)
    .from(plans)
    .innerJoin(users, eq(plans.buyerId, users.id))
    // Plans made before the MCP column existed still carry their MCP session as the owner.
    .where(and(eq(plans.id, planId), or(like(plans.mcpSessionId, `${MCP_SESSION_TAG}%`), like(plans.sessionId, `${MCP_SESSION_TAG}%`))));
  return row === undefined ? null : toPlanRow(row);
}

/** A plan the MCP session made. The session keeps reading it after a browser claims it. */
export async function loadMcpPlan(db: Database, planId: string, mcpSessionId: string): Promise<PlanRow | null> {
  const [row] = await db
    .select(planColumns)
    .from(plans)
    .innerJoin(users, eq(plans.buyerId, users.id))
    .where(and(eq(plans.id, planId), eq(plans.mcpSessionId, mcpSessionId)));
  return row === undefined ? null : toPlanRow(row);
}

/** A plan the browser's session owns, or else one an MCP session shared through its preview link. */
export async function loadPayablePlan(db: Database, planId: string, sessionId: string | null): Promise<PlanRow | null> {
  return (sessionId === null ? null : await loadSessionPlan(db, planId, sessionId)) ?? (await loadSharedPlan(db, planId));
}

/**
 * Hands a plan an MCP session made to the browser that approved its
 * payment, with one activity line. The caller holds the order row lock the
 * approval took, so two approvals cannot both claim.
 */
export async function claimPlan(tx: Transaction, input: { planId: string; orderId: string; paypalOrderId: string | null; claim: PlanClaim }): Promise<{ step: ClaimStep; events: ActivityEventView[] }> {
  const [row] = await tx.select({ sessionId: plans.sessionId, mcpSessionId: plans.mcpSessionId, claimedAt: plans.claimedAt }).from(plans).where(eq(plans.id, input.planId)).for("update");
  const plan = row === undefined ? undefined : { claimedAt: row.claimedAt, mcpSessionId: row.mcpSessionId ?? (isMcpSession(row.sessionId) ? row.sessionId : null) };
  const step = plan === undefined ? "not_shared" : planClaimStep(plan, true);
  if (step !== "claim") return { step, events: [] };
  await tx.update(plans).set({ sessionId: input.claim.sessionId, mcpSessionId: plan?.mcpSessionId, claimedAt: input.claim.at }).where(eq(plans.id, input.planId));
  const events = await insertEvents(tx, {
    runId: input.orderId,
    planId: input.planId,
    orderId: input.orderId,
    agent: "platform",
    drafts: [
      {
        tool: "claim_plan",
        summary: `The browser that approved PayPal order ${input.paypalOrderId ?? "for this plan"} took the plan over from MCP buyer session ${plan?.mcpSessionId ?? ""}, which keeps read access.`,
        sentence: "The browser that approved the payment now holds this room, so the handoff runs there.",
      },
    ],
  });
  return { step, events };
}

/** Plans an MCP session created in the window, claimed ones included, which caps how many rooms it plans an hour. */
export async function countMcpPlans(db: Database, mcpSessionId: string, since: Date): Promise<WindowCount> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`, oldest: sql<string | Date | null>`min(${plans.createdAt})` })
    .from(plans)
    .where(and(eq(plans.mcpSessionId, mcpSessionId), gte(plans.createdAt, since)));
  return { count: row?.count ?? 0, oldest: row?.oldest === null || row?.oldest === undefined ? null : new Date(row.oldest) };
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

/**
 * Live agent runs a browser or a network started in the window. Buyer runs
 * and Sell runs of the seller agent share one count, so the demo's hourly
 * limits cover both screens.
 */
export async function windowCount(tx: Database | Transaction, by: "session" | "client", value: string, since: Date): Promise<WindowCount> {
  const runColumn = by === "session" ? agentRuns.sessionId : agentRuns.clientHash;
  const draftColumn = by === "session" ? listingDrafts.sessionId : listingDrafts.clientHash;
  // MCP runs have limits of their own and never count against a network, since every Claude app connector shares Anthropic's.
  const result = await tx.execute<{ count: number; oldest: string | Date | null }>(sql`
    select count(*)::int as count, min(started) as oldest from (
      select ${agentRuns.startedAt} as started from ${agentRuns} where ${runColumn} = ${value} and ${agentRuns.sessionId} not like ${`${MCP_SESSION_TAG}%`} and ${agentRuns.claudeMode} = 'live' and ${agentRuns.startedAt} >= ${since}
      union all
      select ${listingDrafts.createdAt} from ${listingDrafts} where ${draftColumn} = ${value} and ${listingDrafts.claudeMode} = 'live' and ${listingDrafts.createdAt} >= ${since}
    ) as runs`);
  const row = result.rows[0];
  return { count: row?.count ?? 0, oldest: row?.oldest === null || row?.oldest === undefined ? null : new Date(row.oldest) };
}

/** Live runs every MCP session together started in the window. */
export async function mcpRunCount(tx: Database | Transaction, since: Date): Promise<WindowCount> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int`, oldest: sql<string | Date | null>`min(${agentRuns.startedAt})` })
    .from(agentRuns)
    .where(and(like(agentRuns.sessionId, `${MCP_SESSION_TAG}%`), eq(agentRuns.claudeMode, "live"), gte(agentRuns.startedAt, since)));
  return { count: row?.count ?? 0, oldest: row?.oldest === null || row?.oldest === undefined ? null : new Date(row.oldest) };
}

/** Live Claude calls MCP runs spent since midnight UTC, which may reach 150 of the day's 400. */
export async function mcpClaudeCallsToday(db: Database | Transaction, now: Date): Promise<number> {
  const [row] = await db
    .select({ calls: sql<number>`coalesce(sum(${agentRuns.claudeCalls}), 0)::int` })
    .from(agentRuns)
    .where(and(like(agentRuns.sessionId, `${MCP_SESSION_TAG}%`), eq(agentRuns.claudeMode, "live"), gte(agentRuns.startedAt, startOfUtcDay(now))));
  return row?.calls ?? 0;
}

/** Whether a live run of this session has used up its share of today's Claude calls, checked before each call. */
export async function dailyAllowanceSpent(db: Database, sessionId: string, limits: { total: number; mcp: number }, now: Date): Promise<boolean> {
  if ((await claudeCallsToday(db, now)) >= limits.total) return true;
  return isMcpSession(sessionId) && (await mcpClaudeCallsToday(db, now)) >= limits.mcp;
}

/** Live Claude calls since midnight UTC, from buyer agent runs, verifier comparisons, and seller agent drafts together. */
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
  const [drafts] = await db
    .select({ calls: sql<number>`coalesce(sum(${listingDrafts.claudeCalls}), 0)::int` })
    .from(listingDrafts)
    .where(and(eq(listingDrafts.claudeMode, "live"), gte(listingDrafts.createdAt, since)));
  return (runs?.calls ?? 0) + (comparisons?.calls ?? 0) + (drafts?.calls ?? 0);
}

/**
 * Starts a run in one transaction. The plan row lock lets one run at a time
 * work on a plan, and the limits are counted under the same lock, so two
 * quick presses cannot both pass. A run left running by a stopped process
 * is closed as failed first.
 */
/** One advisory lock for every limit check, so concurrent starts from different plans and Sell drafts count each other. */
export async function lockRunLimits(tx: Transaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('roomover.agent_run_limits'))`);
}

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
      await lockRunLimits(tx);
      const since = new Date(input.now.getTime() - HOUR_MS);
      let decision: LimitDecision;
      if (isMcpSession(input.sessionId)) {
        decision = decideMcpRunLimit({ mcpRuns: await mcpRunCount(tx, since), mcpClaudeCallsToday: await mcpClaudeCallsToday(tx, input.now), claudeCallsToday: await claudeCallsToday(tx, input.now) }, input.kind, input.now);
      } else {
        const counts: LimitCounts = {
          session: await windowCount(tx, "session", input.sessionId, since),
          client: await windowCount(tx, "client", input.clientHash, since),
          claudeCallsToday: await claudeCallsToday(tx, input.now),
        };
        decision = decideLimit(counts, input.kind, input.now);
      }
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

/** Adds Claude calls to a run: one buyer agent turn, or the calls one seller agent made answering an offer. */
export async function addRunUsage(
  db: Database,
  runId: string,
  usage: { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number },
  calls = 1,
): Promise<void> {
  await db
    .update(agentRuns)
    .set({
      claudeCalls: sql`${agentRuns.claudeCalls} + ${calls}`,
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
  input: { runId: string; planId: string | null; orderId?: string; agent: AgentName; drafts: readonly EventDraft[] },
): Promise<ActivityEventView[]> {
  if (input.drafts.length === 0) return [];
  const rows = await db
    .insert(agentEvents)
    .values(
      input.drafts.map((draft) => ({
        runId: input.runId,
        planId: input.planId,
        agent: draft.agent ?? input.agent,
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
