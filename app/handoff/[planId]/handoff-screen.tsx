"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityFeed } from "@/components/furnish/activity-feed";
import { PRIMARY_LINK } from "@/components/furnish/paid-panel";
import { CurrentItem } from "@/components/handoff/current-item";
import { DisputeCard, DisputeHelp } from "@/components/handoff/dispute-card";
import { ItemActions } from "@/components/handoff/item-actions";
import { ItemChecklist, type HandoffChecklistItem } from "@/components/handoff/item-checklist";
import { preparePhoto } from "@/components/photos/prepare-photo";
import { useHandoffStream } from "@/components/handoff/use-handoff-stream";
import { SellersPaid, type SellerPayout } from "@/components/payouts/sellers-paid";
import { PayPalCard, type PayPalReference } from "@/components/paypal/paypal-card";
import { UnderTheHoodProvider, UnderTheHoodSwitch } from "@/components/paypal/under-the-hood";
import { RoomStage } from "@/components/room/room-stage";
import { SHELL_COLUMNS } from "@/components/site/screen-frame";
import type { RoomItemData, RoomPresetData } from "@/components/room/types";
import { ScheduleSection } from "@/components/schedule/schedule-section";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Spinner } from "@/components/ui/spinner";
import { BUYER_STEPS, StepStrip } from "@/components/ui/step-strip";
import type { HandoffChoice } from "@/lib/domain/money-policy";
import { formatDayRange, formatUsdShort } from "@/lib/format";
import type { SampleKind } from "@/lib/handoff/samples";
import type { HandoffItemView, HandoffView } from "@/lib/handoff/view";

interface HandoffScreenProps {
  initialView: HandoffView;
  preset: RoomPresetData;
  roomItems: readonly RoomItemData[];
  buyerFirstName: string;
}

/** Seller rows that land together still fill one after another, so each reads as its own payment. */
const FILL_GAP_MS = 320;

async function readView(response: Response): Promise<{ view?: HandoffView; error?: string }> {
  try {
    return (await response.json()) as { view?: HandoffView; error?: string };
  } catch {
    return { error: "The server did not answer. Try again in a moment." };
  }
}

function checkOf(item: HandoffItemView, isNext: boolean): HandoffChecklistItem["check"] {
  if (item.state === "decided") {
    if (item.decision === "rejected" || item.decision === "missing") return "released";
    return item.decision === "adjusted" ? "adjusted" : "matches";
  }
  if (item.state === "checking") return "checking";
  if (item.state === "failed") return "failed";
  if (item.state === "decide") return "decide";
  return isNext ? "next" : "waiting";
}

/** Payout items in the order PayPal reported them paid, filled one at a time on screen. */
function usePaidIds(view: HandoffView): string[] {
  const target = useMemo(
    () =>
      (view.payout?.sellers ?? [])
        .filter((seller) => seller.status === "succeeded")
        .sort((a, b) => (a.statusChangedAt ?? "").localeCompare(b.statusChangedAt ?? ""))
        .map((seller) => seller.payoutItemId),
    [view.payout],
  );
  const [shown, setShown] = useState<string[]>(target);
  useEffect(() => {
    const missing = target.filter((id) => !shown.includes(id));
    if (missing.length === 0) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setShown((current) => (reduced ? target : [...current, missing[0]])), reduced ? 0 : FILL_GAP_MS);
    return () => window.clearTimeout(timer);
  }, [target, shown]);
  return shown;
}

export function HandoffScreen({ initialView, preset, roomItems, buyerFirstName }: HandoffScreenProps) {
  const [view, setView] = useState(initialView);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; src: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const settleAsked = useRef(false);
  const retakeInput = useRef<HTMLInputElement>(null);

  useHandoffStream(view.planId, setView);
  const paidIds = usePaidIds(view);

  const items = view.items;
  const allDecided = items.every((item) => item.state === "decided");
  const selected = items.find((item) => item.orderItemId === selectedId && item.state !== "decided");
  const current = selected ?? items.find((item) => item.orderItemId === view.nextItemId) ?? null;
  const currentIndex = current === null ? -1 : items.indexOf(current);

  const settle = useCallback(async () => {
    setSettling(true);
    setError(null);
    try {
      const response = await fetch(`/api/handoff/${view.planId}/settle`, { method: "POST" });
      const body = await readView(response);
      if (body.view !== undefined) setView(body.view);
      if (!response.ok) setError(body.error ?? "PayPal did not finish settling. Press Try again.");
    } catch {
      setError("Roomover could not reach the server. Press Try again.");
    } finally {
      setSettling(false);
    }
  }, [view.planId]);

  // The last confirmation moves the money, with no extra tap. A reload in between picks it up here.
  useEffect(() => {
    if (!allDecided || view.phase !== "checking" || settleAsked.current) return;
    settleAsked.current = true;
    void settle();
  }, [allDecided, view.phase, settle]);

  const send = async (item: HandoffItemView, init: RequestInit, path: "photo" | "decision") => {
    setBusyId(item.orderItemId);
    setError(null);
    try {
      const response = await fetch(`/api/handoff/${view.planId}/items/${item.orderItemId}/${path}`, init);
      const body = await readView(response);
      if (body.view !== undefined) setView(body.view);
      if (!response.ok) setError(body.error ?? "That did not go through. Try again.");
      else if (path === "decision") setSelectedId(null);
    } catch {
      setError("Roomover could not reach the server. Try again in a moment.");
    } finally {
      setBusyId(null);
      setPreview(null);
    }
  };

  const onPhoto = async (item: HandoffItemView, file: File) => {
    setPreview({ id: item.orderItemId, src: URL.createObjectURL(file) });
    const form = new FormData();
    form.append("photo", await preparePhoto(file), "handoff.jpg");
    await send(item, { method: "POST", body: form }, "photo");
  };
  const onSample = (item: HandoffItemView, kind: SampleKind) => {
    const sample = item.samples.find((option) => option.kind === kind);
    if (sample !== undefined) setPreview({ id: item.orderItemId, src: sample.src });
    void send(item, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sample: kind }) }, "photo");
  };
  const onRetry = (item: HandoffItemView) => void send(item, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retry: true }) }, "photo");
  const onChoose = (item: HandoffItemView, choice: HandoffChoice) =>
    void send(item, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ choice }) }, "decision");

  const checklist = items.map((item): HandoffChecklistItem => ({
    id: item.orderItemId,
    title: item.title,
    sellerFirstName: item.sellerFirstName,
    photo: { src: item.listingPhoto.src },
    check: checkOf(item, item.orderItemId === view.nextItemId),
    note: item.note ?? undefined,
  }));

  const order = view.order;
  const total = formatUsdShort(order.totalCents);
  const heldRefs: PayPalReference[] = [
    ...(order.paypalOrderId === null ? [] : [{ api: "Orders v2", label: "Order", id: order.paypalOrderId }]),
    ...(order.authorizationId === null ? [] : [{ api: "Orders v2", label: "Authorization", id: order.authorizationId }]),
    ...(order.reauthorizationId === null ? [] : [{ api: "Payments v2", label: "Reauthorization", id: order.reauthorizationId }]),
    ...(order.captureId === null ? [] : [{ api: "Orders v2", label: "Capture", id: order.captureId }]),
  ];
  const settledRefs: PayPalReference[] = [
    ...items.flatMap((item) => (item.settlement.captureId === null ? [] : [{ api: "Payments v2", label: `Capture, ${item.sellerFirstName}'s ${item.noun}`, id: item.settlement.captureId }])),
    ...items.flatMap((item) => (item.settlement.refundId === null ? [] : [{ api: "Payments v2", label: `Refund, ${item.sellerFirstName}'s ${item.noun}`, id: item.settlement.refundId }])),
    ...(order.voided && order.authorizationId !== null ? [{ api: "Payments v2", label: "Voided authorization", id: order.reauthorizationId ?? order.authorizationId }] : []),
    ...(!order.voided && order.authorizationId !== null && view.totals.releasedCents > 0 && view.totals.agreedCents > 0 && items.some((item) => item.settlement.captureId !== null)
      ? [{ api: "Payments v2", label: `Authorization, final capture released ${formatUsdShort(view.totals.releasedCents)}`, id: order.reauthorizationId ?? order.authorizationId }]
      : []),
  ];
  const paidRefs: PayPalReference[] =
    view.payout === null
      ? []
      : [
          ...(view.payout.paypalBatchId === null ? [] : [{ api: "Payouts", label: "Payout batch", id: view.payout.paypalBatchId }]),
          ...view.payout.sellers.flatMap((seller) => (seller.paypalPayoutItemId === null ? [] : [{ api: "Payouts", label: `Payout item, ${seller.sellerName}`, id: seller.paypalPayoutItemId }])),
        ];

  const anyCaptured = items.some((item) => item.settlement.captureId !== null || item.settlement.refundId !== null) || order.voided;
  const agreed = formatUsdShort(view.totals.agreedCents);
  const released = view.totals.releasedCents;
  const capturedCard =
    order.paymentMode === "authorize_then_capture"
      ? { title: view.totals.agreedCents === 0 ? `PayPal released your ${total} hold` : `PayPal captured ${agreed}`, detail: released > 0 && view.totals.agreedCents > 0 ? `The other ${formatUsdShort(released)} went back to ${buyerFirstName}.` : `For ${items.length === 1 ? "1 item" : `${items.length} items`} you checked.` }
      : { title: `Roomover keeps ${agreed} for the sellers`, detail: released > 0 ? `PayPal refunded ${formatUsdShort(released)} to ${buyerFirstName}.` : "PayPal captured it at checkout." };

  const disputeFor = (sellerName: string) => view.disputes.find((dispute) => dispute.sellerName === sellerName);
  const sellerRows: SellerPayout[] = (view.payout?.sellers ?? []).map((seller) => ({
    payoutItemId: seller.payoutItemId,
    sellerName: seller.sellerName,
    itemTitle: seller.itemTitle,
    amountCents: seller.amountCents,
    note:
      seller.status === "unclaimed"
        ? { text: "Unclaimed, PayPal holds it 30 days", alert: false }
        : seller.status === "pending" || seller.status === "held" || seller.status === "succeeded"
          ? undefined
          : { text: `Payout ${seller.status}`, alert: true },
    ...(disputeFor(seller.sellerName) === undefined ? {} : { dispute: { text: disputeFor(seller.sellerName)?.status === "resolved" ? "Dispute closed" : "Dispute open", open: disputeFor(seller.sellerName)?.status !== "resolved" } }),
  }));
  const allPaid = sellerRows.length > 0 && paidIds.length === sellerRows.length;
  const moneyBack = view.events.filter((event) => event.tool === "money_back" && event.sentence !== null);
  const releaseLine = view.events.findLast((event) => event.tool === "release_order")?.sentence ?? null;
  const step = view.phase === "paid" ? 3 : view.phase === "released" ? 0 : 2;
  const pickup = view.pickup === null ? null : formatDayRange(new Date(view.pickup.startsAt), new Date(view.pickup.endsAt));
  const subtitle =
    view.phase === "paid"
      ? `All ${items.length} items checked in ${view.roomLabel}`
      : pickup === null
        ? `${items.length} items in ${view.roomLabel}`
        : `Pickup ${pickup} in ${view.roomLabel}`;
  const mark = current !== null && current.itemKey !== null && view.phase === "checking" ? { key: current.itemKey, label: `Next, ${current.noun} from ${current.sellerFirstName}` } : null;
  const working = settling || view.phase === "settling" || (allDecided && view.phase === "checking");

  const checkingItem = view.phase === "checking" && !allDecided ? current : null;
  const errorLine =
    error === null ? null : (
      <p role="alert" className="text-sm font-medium text-brick">
        {error}
      </p>
    );
  const actions = (item: HandoffItemView) => (
    <ItemActions
      item={item}
      busy={busyId !== null}
      onPhoto={(file) => void onPhoto(item, file)}
      onSample={(kind) => onSample(item, kind)}
      onRetry={() => onRetry(item)}
      onChoose={(choice) => onChoose(item, choice)}
    />
  );
  const footer =
    checkingItem !== null ? (
      <div data-item-actions="desktop" className="flex flex-col gap-3">
        {errorLine}
        {actions(checkingItem)}
      </div>
    ) : working && view.phase !== "paid" ? (
      order.settlementError !== null && !settling ? (
        <>
          <p role="alert" className="text-sm font-medium text-brick">
            {error ?? order.settlementError}
          </p>
          <Button className="w-full" onClick={() => void settle()}>
            Try again
          </Button>
        </>
      ) : (
        <p role="status" className="flex min-h-13 items-center gap-2 text-sm text-flint">
          <Spinner className="size-3.5" />
          PayPal is settling {items.length === 1 ? "1 item" : `${items.length} items`}
        </p>
      )
    ) : view.phase === "paid" ? (
      <Link href="/" className={`${PRIMARY_LINK} w-full`}>
        Done
      </Link>
    ) : view.phase === "released" ? (
      <Link href="/furnish" className={`${PRIMARY_LINK} w-full`}>
        Plan a room again
      </Link>
    ) : undefined;

  return (
    <main className={SHELL_COLUMNS}>
      <section aria-label={`${view.roomLabel}, the room`} className="flex min-w-0 flex-col gap-4 max-lg:hidden lg:h-full lg:min-h-0">
        {/* On a short screen the open schedule takes the room's place, label and all, so neither shrinks to a sliver. */}
        <div data-handoff-room className={`flex min-h-[200px] flex-1 flex-col ${scheduleOpen ? "[@media(max-height:879px)]:hidden" : ""}`}>
          <RoomStage label={view.roomLabel} preset={preset} items={roomItems} showList={false} mark={mark} fill />
        </div>
        <ScheduleSection schedule={view.schedule} planId={view.planId} collapsible onOpenChange={setScheduleOpen} onView={setView} />
      </section>

      <UnderTheHoodProvider>
        <Panel
          id="handoff-panel"
          heading="h1"
          shell
          title={view.phase === "paid" ? "Handoff done" : view.phase === "released" ? "Handoff closed" : "Handoff"}
          subtitle={subtitle}
          action={<UnderTheHoodSwitch />}
          top={<StepStrip steps={BUYER_STEPS} current={step} label="Handoff progress" />}
          footer={footer}
          footerClassName={checkingItem !== null ? "max-lg:hidden" : ""}
        >
          {checkingItem !== null && (
            <>
              <p className="text-sm text-flint">Take a photo of each item. Roomover compares it with the seller&apos;s photos.</p>
              <CurrentItem
                item={checkingItem}
                index={currentIndex}
                total={items.length}
                preview={preview?.id === checkingItem.orderItemId ? preview.src : null}
                onRetake={busyId === null && (checkingItem.state === "decide" || checkingItem.state === "failed") ? () => retakeInput.current?.click() : undefined}
              />
              <input
                ref={retakeInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file !== undefined) void onPhoto(checkingItem, file);
                }}
              />
              <div data-item-actions="mobile" className="flex flex-col gap-3 lg:hidden">
                {errorLine}
                {actions(checkingItem)}
              </div>
              <ItemChecklist items={checklist} currentId={checkingItem.orderItemId} onSelect={busyId === null ? setSelectedId : undefined} />
              {order.paymentMode === "authorize_then_capture" ? (
                <PayPalCard moment="held" title={`PayPal is holding ${total}`} detail="Until you finish checking every item" references={heldRefs} />
              ) : (
                <PayPalCard moment="held" title={`Roomover holds your ${total}`} detail="PayPal captured it at checkout. Anything you turn down is refunded." references={heldRefs} />
              )}
              <ActivityFeed events={view.events} shown={0} />
            </>
          )}

          {working && view.phase !== "paid" && (
            <>
              <ItemChecklist items={checklist} currentId={null} />
              <ActivityFeed events={view.events} />
              {anyCaptured && <PayPalCard moment="captured" title={capturedCard.title} detail={capturedCard.detail} references={settledRefs} />}
            </>
          )}

          {view.phase === "paid" && (
            <>
              {view.disputes.map((dispute) => (
                <DisputeCard key={dispute.paypalDisputeId} dispute={dispute} events={view.events} />
              ))}
              {sellerRows.length > 0 ? (
                <SellersPaid payouts={sellerRows} paidIds={paidIds} />
              ) : (
                <p className="text-base">You turned every item down, so no seller was paid.</p>
              )}
              {moneyBack.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {moneyBack.map((event) => (
                    <li key={event.seq} className="text-base">
                      {event.sentence}
                    </li>
                  ))}
                </ul>
              )}
              <PayPalCard moment="captured" title={capturedCard.title} detail={capturedCard.detail} references={settledRefs} />
              {allPaid && view.payout !== null && (
                <PayPalCard
                  moment="paid"
                  title={`PayPal paid ${sellerRows.length === 1 ? "1 seller" : `${sellerRows.length} sellers`} ${formatUsdShort(view.payout.totalCents)}`}
                  detail="One payout sent each seller their share"
                  references={paidRefs}
                />
              )}
              {!allPaid && sellerRows.length > 0 && (
                <p role="status" className="flex items-center gap-2 text-sm text-flint">
                  <Spinner className="size-3.5" />
                  Waiting for PayPal to confirm each payout
                </p>
              )}
              {allPaid && <DisputeHelp />}
              <ActivityFeed events={view.events} shown={0} />
            </>
          )}

          {view.phase === "released" && (
            <>
              <p className="text-base">{releaseLine ?? `PayPal released your ${total}, so nothing was charged.`}</p>
              <p className="text-sm text-flint">The items went back on sale for other students.</p>
              <ActivityFeed events={view.events} shown={0} />
            </>
          )}
        </Panel>
      </UnderTheHoodProvider>

      {/* The timeline is far wider than a phone, so this grid item may shrink below it and scroll inside. */}
      <div className="min-w-0 lg:hidden">
        <ScheduleSection schedule={view.schedule} planId={view.planId} onView={setView} />
      </div>
    </main>
  );
}
