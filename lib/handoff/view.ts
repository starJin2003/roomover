import type { HandoffOrder } from "@/lib/db/handoffs";
import type { HandoffDecision, OrderItemStatus, OrderStatus, PaymentMode, PayoutItemStatus, PayoutStatus } from "@/lib/domain/enums";
import type { FurnitureType } from "@/lib/domain/furniture";
import { choicesFor, settleChoice, type Finding, type HandoffChoice } from "@/lib/domain/money-policy";
import { payoutBatchFinal, payoutItemWaiting } from "@/lib/domain/payout-state";
import { settlementTotals } from "@/lib/domain/settlement";
import type { Damage, Verdict } from "@/lib/domain/verdict";
import type { ActivityEventView } from "@/lib/plan-view";
import { samplesFor, type SampleOption } from "./samples";
import { findingSentence, firstNameOf, rowNote, shortNoun } from "./words";

/** Where an item stands at handoff, in the order the student meets the states. */
export type ItemState = "waiting" | "checking" | "failed" | "decide" | "decided";

export interface ChoiceView {
  choice: HandoffChoice;
  payCents: number;
  releasedCents: number;
}

export interface HandoffItemView {
  orderItemId: string;
  /** The item's key in the room layout, which the 3D room rings when it is next. */
  itemKey: string | null;
  title: string;
  noun: string;
  sellerName: string;
  sellerFirstName: string;
  priceCents: number;
  listingPhoto: { src: string; alt: string; widthPx: number; heightPx: number };
  samples: SampleOption[];
  photo: { src: string; source: "upload" | "sample" } | null;
  state: ItemState;
  verdict: { verdict: Verdict; damage: Damage | null; confidence: string; observations: string } | null;
  /** What the verifier found, and what the student pays for it. */
  finding: string | null;
  /** The short line under the checklist row. */
  note: string | null;
  verifierError: string | null;
  choices: ChoiceView[];
  decision: HandoffDecision | null;
  payCents: number | null;
  settlement: { status: OrderItemStatus; captureId: string | null; refundId: string | null; capturedCents: number; refundedCents: number };
}

export interface SellerPaidView {
  payoutItemId: string;
  paypalPayoutItemId: string | null;
  sellerName: string;
  itemTitle: string;
  amountCents: number;
  status: PayoutItemStatus;
  statusChangedAt: string | null;
}

export type HandoffPhase = "checking" | "settling" | "paid" | "released";

export interface HandoffView {
  planId: string;
  orderId: string;
  roomLabel: string;
  phase: HandoffPhase;
  /** The window every item can be picked up in, when the items share one. */
  pickup: { startsAt: string; endsAt: string } | null;
  order: {
    status: OrderStatus;
    paymentMode: PaymentMode;
    totalCents: number;
    paypalOrderId: string | null;
    authorizationId: string | null;
    reauthorizationId: string | null;
    captureId: string | null;
    voided: boolean;
    settlementError: string | null;
  };
  items: HandoffItemView[];
  /** The first item still to check, which the screen leads with. */
  nextItemId: string | null;
  totals: { heldCents: number; agreedCents: number; releasedCents: number };
  payout: { senderBatchId: string; paypalBatchId: string | null; status: PayoutStatus; totalCents: number; waiting: boolean; sellers: SellerPaidView[] } | null;
  events: ActivityEventView[];
}

export interface LayoutRef {
  key: string;
  furnitureType: FurnitureType;
  /** Where the item stands in the plan's placement order, which the checklist follows. */
  index: number;
}

function findingOf(item: HandoffOrder["items"][number]): Finding | null {
  const report = item.handoff?.report;
  if (report === null || report === undefined) return null;
  return report.verdict === "new_damage" ? { verdict: "new_damage", damage: { severity: report.damage?.severity ?? "minor" } } : { verdict: report.verdict };
}

function itemState(item: HandoffOrder["items"][number]): ItemState {
  const handoff = item.handoff;
  if (handoff === null) return "waiting";
  if (handoff.decision !== null) return "decided";
  if (handoff.report !== null) return "decide";
  if (handoff.verifierError !== null) return "failed";
  if (handoff.status === "verifying") return "checking";
  return "waiting";
}

const PHASE: Readonly<Record<OrderStatus, HandoffPhase>> = {
  pending_approval: "checking",
  approved: "checking",
  authorized: "checking",
  capture_pending: "checking",
  captured: "checking",
  capture_declined: "checking",
  settling: "settling",
  settled: "paid",
  canceled: "released",
  voided: "released",
  reversed: "released",
  releasing: "released",
  refunded: "released",
};

export function buildHandoffView(input: { order: HandoffOrder; roomLabel: string; layout: ReadonlyMap<string, LayoutRef>; events: readonly ActivityEventView[] }): HandoffView {
  const { order } = input;
  const placed = (listingId: string) => input.layout.get(listingId)?.index ?? Number.MAX_SAFE_INTEGER;
  const items = [...order.items].sort((a, b) => placed(a.listingId) - placed(b.listingId)).map((item): HandoffItemView => {
    const ref = input.layout.get(item.listingId);
    const noun = ref === undefined ? item.title.toLowerCase() : shortNoun(ref.furnitureType);
    const sellerFirstName = firstNameOf(item.sellerName);
    const report = item.handoff?.report ?? null;
    const finding = findingOf(item);
    const state = itemState(item);
    const photo = item.handoff?.photos.at(-1) ?? null;
    const words = { sellerFirstName, noun, priceCents: item.amountCents };
    return {
      orderItemId: item.orderItemId,
      itemKey: ref?.key ?? null,
      title: item.title,
      noun,
      sellerName: item.sellerName,
      sellerFirstName,
      priceCents: item.amountCents,
      listingPhoto: item.photos[0],
      samples: samplesFor(item.photos[0].src),
      photo: photo === null ? null : { src: photo.src, source: photo.source },
      state,
      verdict: report === null ? null : { verdict: report.verdict, damage: report.damage, confidence: report.confidence, observations: report.observations },
      finding: report === null ? null : findingSentence(words, report.verdict, report.damage),
      note: state === "decided" || state === "decide" ? rowNote(report?.verdict ?? null, report?.damage ?? null, item.handoff?.decision ?? null, item.handoff?.payCents ?? null) : null,
      verifierError: item.handoff?.verifierError ?? null,
      choices: state === "decide" && finding !== null ? choicesFor(finding).map((choice) => ({ choice, ...settleChoice(finding, choice, item.amountCents) })) : [],
      decision: item.handoff?.decision ?? null,
      payCents: item.handoff?.payCents ?? null,
      settlement: { status: item.status, captureId: item.paypalCaptureId, refundId: item.paypalRefundId, capturedCents: item.capturedAmountCents, refundedCents: item.refundedAmountCents },
    };
  });

  const decided = order.items.filter((item) => item.handoff?.payCents !== null && item.handoff?.payCents !== undefined);
  const totals = settlementTotals(order.items.map((item) => ({ amountCents: item.amountCents, payCents: item.handoff?.payCents ?? item.amountCents })));
  const titles = new Map<string, string[]>();
  for (const item of order.items) if ((item.handoff?.payCents ?? 0) > 0) titles.set(item.sellerId, [...(titles.get(item.sellerId) ?? []), item.title]);
  // Sellers paid follows the checklist, by each seller's first item in the room.
  const firstPlaced = (sellerId: string) => Math.min(...order.items.filter((item) => item.sellerId === sellerId).map((item) => placed(item.listingId)));

  const slots = order.items.flatMap((item) => (item.handoff === null ? [] : [item.handoff]));
  const startsAt = Math.max(...slots.map((slot) => slot.slotStartsAt.getTime()));
  const endsAt = Math.min(...slots.map((slot) => slot.slotEndsAt.getTime()));

  return {
    planId: order.planId,
    orderId: order.id,
    roomLabel: input.roomLabel,
    phase: PHASE[order.status],
    pickup: slots.length > 0 && startsAt < endsAt ? { startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() } : null,
    order: {
      status: order.status,
      paymentMode: order.paymentMode,
      totalCents: order.totalCents,
      paypalOrderId: order.paypalOrderId,
      authorizationId: order.paypalAuthorizationId,
      reauthorizationId: order.paypalReauthorizationId,
      captureId: order.paypalCaptureId,
      voided: order.voidedAt !== null,
      settlementError: order.settlementError,
    },
    items,
    nextItemId: items.find((item) => item.state !== "decided")?.orderItemId ?? null,
    totals: { heldCents: totals.heldCents, agreedCents: decided.length === order.items.length ? totals.paidCents : totals.heldCents, releasedCents: decided.length === order.items.length ? totals.releasedCents : 0 },
    payout:
      order.payout === null
        ? null
        : {
            senderBatchId: order.payout.senderBatchId,
            paypalBatchId: order.payout.paypalBatchId,
            status: order.payout.status,
            totalCents: order.payout.totalCents,
            waiting: order.payout.paypalBatchId === null || !payoutBatchFinal(order.payout.status) || order.payout.items.some((item) => payoutItemWaiting(item.status)),
            sellers: [...order.payout.items].sort((a, b) => firstPlaced(a.sellerId) - firstPlaced(b.sellerId)).map((item) => ({
              payoutItemId: item.id,
              paypalPayoutItemId: item.paypalPayoutItemId,
              sellerName: item.sellerName,
              itemTitle: (titles.get(item.sellerId) ?? []).join(", "),
              amountCents: item.amountCents,
              status: item.status,
              statusChangedAt: item.statusChangedAt?.toISOString() ?? null,
            })),
          },
    events: [...input.events],
  };
}
