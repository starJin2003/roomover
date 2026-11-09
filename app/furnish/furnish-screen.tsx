"use client";

import { useCallback, useMemo, useState } from "react";
import { ActivityFeed } from "@/components/furnish/activity-feed";
import { ChangeRequest } from "@/components/furnish/change-request";
import { PlanForm } from "@/components/furnish/plan-form";
import { UnderTheHoodLog } from "@/components/furnish/under-the-hood-log";
import { usePlanStream } from "@/components/furnish/use-plan-stream";
import { HandoffLink, PaidPanel } from "@/components/furnish/paid-panel";
import { PayPalCheckout } from "@/components/paypal/paypal-checkout";
import { UnderTheHoodProvider, UnderTheHoodSwitch } from "@/components/paypal/under-the-hood";
import { RoomStage, type MoveResult, type RoomEditing } from "@/components/room/room-stage";
import { SHELL_COLUMNS } from "@/components/site/screen-frame";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { PanelState } from "@/components/ui/panel-state";
import { Spinner } from "@/components/ui/spinner";
import { BUYER_STEPS, StepStrip } from "@/components/ui/step-strip";
import type { FitProblem } from "@/lib/domain/fit";
import type { Spot } from "@/lib/domain/placement";
import { fitProblemWords, itemNoun } from "@/lib/domain/room-words";
import { formatUsdShort } from "@/lib/format";
import type { ActivityEventView, PlanView } from "@/lib/plan-view";
import type { FurnishPreset } from "../screen-data";

const DEFAULT_PROMPT = "$150, cozy, I study late";
const AGENT_BUSY = "The buyer agent is working on this room. You can move things when it finishes.";

interface FurnishScreenProps {
  /** The sandbox app's client ID, which the PayPal SDK loads with in the browser. */
  paypalClientId: string;
  presets: readonly FurnishPreset[];
  listingCount: number;
  initialPlan: PlanView | null;
  initialEvents: readonly ActivityEventView[];
}

interface Refusal {
  message: string;
  retryAt: string | null;
}

const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

async function readError(response: Response): Promise<{ error: string; retryAt?: string; problems?: FitProblem[] }> {
  try {
    return (await response.json()) as { error: string; retryAt?: string; problems?: FitProblem[] };
  } catch {
    return { error: "The server did not answer. Try again in a moment." };
  }
}

function mergeEvents(current: readonly ActivityEventView[], incoming: readonly ActivityEventView[]): ActivityEventView[] {
  const seen = new Set(current.map((event) => event.seq));
  const fresh = incoming.filter((event) => !seen.has(event.seq));
  return fresh.length === 0 ? [...current] : [...current, ...fresh].sort((a, b) => a.seq - b.seq);
}

const PAID_STATUSES: ReadonlySet<string> = new Set(["authorized", "capture_pending", "captured", "settling", "settled", "releasing"]);
/** A paid room whose handoff has not moved money yet, which a new plan releases. */
const RELEASABLE_STATUSES: ReadonlySet<string> = new Set(["authorized", "captured"]);

export function FurnishScreen({ paypalClientId, presets, listingCount, initialPlan, initialEvents }: FurnishScreenProps) {
  const [plan, setPlan] = useState<PlanView | null>(initialPlan);
  const [events, setEvents] = useState<readonly ActivityEventView[]>(initialEvents);
  const [composing, setComposing] = useState(initialPlan === null || (initialPlan.items.length === 0 && initialPlan.run?.status !== "running"));
  const [presetSlug, setPresetSlug] = useState(initialPlan?.presetSlug ?? presets[0]?.slug ?? "");
  const [prompt, setPrompt] = useState(initialPlan?.stylePrompt ?? DEFAULT_PROMPT);
  const [submitting, setSubmitting] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  const lastSeq = events.at(-1)?.seq ?? 0;
  const onPlan = useCallback((next: PlanView) => setPlan((current) => (current === null || current.id === next.id ? next : current)), []);
  const onEvent = useCallback((event: ActivityEventView) => setEvents((current) => mergeEvents(current, [event])), []);
  const stream = usePlanStream(plan?.id ?? null, lastSeq, onPlan, onEvent);

  const running = plan?.run?.status === "running";
  const phase = composing ? "plan" : running && plan?.run?.kind === "plan" ? "filling" : "ready";
  const preset = presets.find((candidate) => candidate.slug === (phase === "plan" ? presetSlug : plan?.presetSlug)) ?? presets[0];
  const items = useMemo(() => (phase === "plan" || plan === null ? [] : plan.items), [phase, plan]);

  const startPlan = async (text: string) => {
    setSubmitting(true);
    setPromptError(null);
    setRefusal(null);
    setPrompt(text);
    try {
      const response = await fetch("/api/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ presetSlug, prompt: text }) });
      if (!response.ok) {
        const body = await readError(response);
        if (response.status === 422) setPromptError(body.error);
        else setRefusal({ message: body.error, retryAt: body.retryAt ?? null });
        return;
      }
      const body = (await response.json()) as { planId: string; runId: string; roomLabel: string };
      const startedAt = new Date().toISOString();
      setEvents([]);
      setPlan({
        id: body.planId,
        status: "planning",
        presetSlug,
        roomLabel: body.roomLabel,
        budgetCents: 0,
        stylePrompt: text,
        items: [],
        totalCents: 0,
        usedCents: 0,
        newItemsCents: 0,
        savings: { paidCents: 0, newCents: 0, savedCents: 0, compared: 0, total: 0 },
        negotiations: [],
        run: { id: body.runId, kind: "plan", status: "running", request: null, error: null, startedAt, finishedAt: null },
        checkout: null,
      });
      setComposing(false);
    } catch {
      setRefusal({ message: "Roomover could not reach the server. Check the connection and try again.", retryAt: null });
    } finally {
      setSubmitting(false);
    }
  };

  const ask = async (request: string): Promise<boolean> => {
    if (plan === null) return false;
    setAsking(true);
    setAskError(null);
    try {
      const response = await fetch(`/api/plans/${plan.id}/requests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request }) });
      if (!response.ok) {
        const body = await readError(response);
        const retry = body.retryAt === undefined ? "" : ` Try again after ${clock.format(new Date(body.retryAt))}.`;
        setAskError(`${body.error}${retry}`);
        return false;
      }
      const { runId } = (await response.json()) as { runId: string };
      setPlan((current) =>
        current === null ? current : { ...current, run: { id: runId, kind: "edit", status: "running", request, error: null, startedAt: new Date().toISOString(), finishedAt: null } },
      );
      return true;
    } catch {
      setAskError("Roomover could not reach the server. Try again in a moment.");
      return false;
    } finally {
      setAsking(false);
    }
  };

  const onMove = useCallback(
    async (key: string, spot: Spot): Promise<MoveResult> => {
      if (plan === null) return { ok: false, message: "Plan the room first." };
      try {
        const response = await fetch(`/api/plans/${plan.id}/layout`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemKey: key, ...spot }),
        });
        if (!response.ok) {
          const body = await readError(response);
          const layout = { items: plan.items.map((item) => item.layout) };
          const problem = body.problems?.[0];
          return { ok: false, message: problem === undefined ? body.error : fitProblemWords(problem, layout) };
        }
        const body = (await response.json()) as { plan: PlanView };
        setPlan(body.plan);
        return { ok: true };
      } catch {
        return { ok: false, message: "Roomover could not save the move. Try again in a moment." };
      }
    },
    [plan],
  );

  const editing = useMemo<RoomEditing | null>(() => {
    if (phase !== "ready" || preset === undefined || items.length === 0) return null;
    return {
      room: { widthMm: preset.widthMm, depthMm: preset.depthMm, ceilingHeightMm: preset.ceilingHeightMm, geometry: preset.geometry, egressPathMm: preset.egressPathMm },
      onMove,
      locked: running ? AGENT_BUSY : null,
    };
  }, [phase, preset, items.length, onMove, running]);

  if (preset === undefined) {
    return (
      <main className="mx-auto w-full max-w-[1360px] px-4 sm:px-10">
        <PanelState kind="error" title="No rooms to plan" body="Room presets come from Postgres, and none were found. Reload the page to try again." />
      </main>
    );
  }

  const label = phase === "plan" ? preset.label : (plan?.roomLabel ?? preset.label);
  const example = items.find((item) => item.layout.placement === "floor") ?? items[0];
  const exampleRequest = example === undefined ? "Move the desk lamp closer to the bed" : `Move the ${itemNoun(example.layout)} to the window`;
  const budget = plan?.budgetCents ?? 0;
  const saved = plan?.savings.savedCents ?? 0;
  const newItems = plan === null ? [] : plan.items.filter((item) => item.newFrom !== undefined);
  const run = plan?.run ?? null;
  const failed = run?.status === "failed";
  const checkout = plan?.checkout ?? null;
  const paid = checkout !== null && PAID_STATUSES.has(checkout.status);
  const releasable = checkout !== null && RELEASABLE_STATUSES.has(checkout.status);
  const released = checkout !== null && (checkout.status === "voided" || checkout.status === "refunded");
  const step = phase !== "ready" || failed ? 0 : paid ? 2 : 1;

  const newPlan = async () => {
    if (plan === null) return;
    if (releasable) {
      setReleasing(true);
      setReleaseError(null);
      try {
        const response = await fetch(`/api/plans/${plan.id}/release`, { method: "POST" });
        if (!response.ok) {
          setReleaseError((await readError(response)).error);
          return;
        }
      } catch {
        setReleaseError("Roomover could not reach the server. Try again in a moment.");
        return;
      } finally {
        setReleasing(false);
      }
    }
    setPresetSlug(plan.presetSlug);
    setComposing(true);
  };

  const pending = phase === "ready" && !paid;
  const footer =
    phase === "ready" && paid && checkout !== null ? (
      <HandoffLink planId={plan?.id ?? ""} checkout={checkout} />
    ) : pending && plan !== null ? (
      <PayPalCheckout
        clientId={paypalClientId}
        planId={plan.id}
        amountCents={plan.usedCents}
        disabledReason={running ? "The buttons wait until the buyer agent finishes your change." : null}
        onPaid={setPlan}
      />
    ) : undefined;

  return (
    <main className={SHELL_COLUMNS}>
      <section aria-label={`${label}, the room`} className="min-w-0 lg:h-full lg:min-h-0">
        <RoomStage key={preset.slug} label={label} preset={preset} items={items} ring editing={editing} showList={phase !== "plan"} fill />
      </section>

      <UnderTheHoodProvider>
        <Panel
          id="furnish-panel"
          heading="h1"
          sheet
          shell
          title={label}
          subtitle={phase === "plan" ? preset.description : `Jordan's room, ${budget > 0 ? `${formatUsdShort(budget)} budget` : "planning"}`}
          action={phase === "plan" ? undefined : <UnderTheHoodSwitch />}
          top={<StepStrip steps={BUYER_STEPS} current={step} label="Furnish progress" />}
          footer={footer}
          footerClassName={pending ? "max-lg:sticky max-lg:bottom-0 max-lg:z-10 max-lg:border-t max-lg:border-hair max-lg:bg-paper max-lg:pb-[max(1rem,env(safe-area-inset-bottom))]" : ""}
        >
          {phase === "plan" && (
            <>
              {failed && plan !== null && (
                <PanelState kind="error" title="The last plan stopped" body={run?.error ?? "The buyer agent stopped before it placed anything."} />
              )}
              {refusal !== null && (
                <PanelState
                  kind="error"
                  title={refusal.retryAt === null ? "The plan did not start" : "The demo limit is reached for now"}
                  body={`${refusal.message}${refusal.retryAt === null ? "" : ` Try again after ${clock.format(new Date(refusal.retryAt))}.`}`}
                />
              )}
              <PlanForm
                presets={presets}
                presetSlug={presetSlug}
                onPresetChange={setPresetSlug}
                defaultPrompt={prompt}
                listingCount={listingCount}
                submitting={submitting}
                promptError={promptError}
                onSubmit={startPlan}
              />
            </>
          )}

          {phase !== "plan" && plan !== null && (
            <>
              <ActivityFeed events={events} />
              {stream === "reconnecting" && running && (
                <p role="status" className="flex items-center gap-2 text-sm text-flint">
                  <Spinner className="size-3.5" />
                  Reconnecting to the activity feed
                </p>
              )}
              <div className="flex flex-col gap-1">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-2xl font-semibold tabular-nums" data-total={plan.usedCents}>
                    {formatUsdShort(plan.usedCents)}
                  </span>
                  <span className="text-base text-flint">{newItems.length === 0 ? `of your ${formatUsdShort(budget)}` : "through PayPal for the used items"}</span>
                </p>
                {newItems.map((item) => (
                  <p key={item.layout.key} data-new-item-line className="text-sm">
                    Plus {formatUsdShort(item.priceCents)} for a new {item.title.toLowerCase()}, bought at{" "}
                    <a
                      href={item.newFrom?.buyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline decoration-stone underline-offset-4 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    >
                      {item.newFrom?.retailer}
                      <span className="sr-only">, opens in a new tab</span>
                    </a>
                  </p>
                ))}
                {newItems.length > 0 && (
                  <p className="text-sm text-flint tabular-nums">
                    {formatUsdShort(plan.totalCents)} of your {formatUsdShort(budget)} in all
                  </p>
                )}
                {phase === "filling" ? (
                  <p role="status" className="flex items-center gap-2 text-sm text-flint">
                    <Spinner className="size-3.5" />
                    {plan.items.length === 0 ? "The buyer agent is reading the room" : `Placing items, ${plan.items.length} so far`}
                  </p>
                ) : (
                  saved > 0 && (
                    <p data-savings className="text-sm text-flint">
                      {formatUsdShort(saved)} less than the cheapest comparable new items on Channel3
                    </p>
                  )
                )}
              </div>
              <UnderTheHoodLog negotiations={plan.negotiations} events={events} />

              {phase === "ready" && paid && checkout !== null && <PaidPanel checkout={checkout} />}
              {pending && (
                <>
                  {released && <p className="text-sm text-flint">PayPal released your last payment for this room, so nothing was charged. Press PayPal to pay again.</p>}
                  {failed && plan.items.length > 0 && run?.kind === "edit" && (
                    <p className="text-sm font-medium text-brick">The change did not finish. {run.error}</p>
                  )}
                  <ChangeRequest example={exampleRequest} busy={asking} disabledReason={running ? AGENT_BUSY : null} error={askError} onSend={ask} />
                </>
              )}
              {phase === "ready" && (
                <div className="flex flex-col gap-1">
                  <Button variant="quiet" size="sm" className="self-start" disabled={running || releasing} loadingLabel={releasing ? "Releasing your hold" : undefined} onClick={() => void newPlan()}>
                    Start a new plan
                  </Button>
                  {releasable && checkout !== null && releaseError === null && (
                    <p className="text-xs text-flint">This gives your {formatUsdShort(checkout.totalCents)} back through PayPal first.</p>
                  )}
                  {releaseError !== null && (
                    <p role="alert" className="text-sm font-medium text-brick">
                      {releaseError}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </Panel>
      </UnderTheHoodProvider>
    </main>
  );
}
