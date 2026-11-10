"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ActivityFeed } from "@/components/furnish/activity-feed";
import { HandoffLink, PaidPanel } from "@/components/furnish/paid-panel";
import { UnderTheHoodLog } from "@/components/furnish/under-the-hood-log";
import { usePlanStream } from "@/components/furnish/use-plan-stream";
import { PayPalCheckout } from "@/components/paypal/paypal-checkout";
import { UnderTheHoodProvider, UnderTheHoodSwitch } from "@/components/paypal/under-the-hood";
import { RoomStage } from "@/components/room/room-stage";
import type { RoomItemData } from "@/components/room/types";
import { SHELL_COLUMNS } from "@/components/site/screen-frame";
import { Panel } from "@/components/ui/panel";
import { Spinner } from "@/components/ui/spinner";
import { BUYER_STEPS, StepStrip } from "@/components/ui/step-strip";
import { assistantInSentence } from "@/lib/domain/mcp";
import { formatUsdShort } from "@/lib/format";
import type { ActivityEventView, PlanView } from "@/lib/plan-view";
import type { PreviewNotice } from "@/lib/preview";
import type { FurnishPreset } from "../../screen-data";

/** Who holds the plan: nobody yet, the browser that approved its payment and is looking now, or another browser. */
export type PreviewHolder = "open" | "this_browser" | "another_browser";

interface PreviewScreenProps {
  paypalClientId: string;
  holder: PreviewHolder;
  preset: FurnishPreset;
  initialPlan: PlanView;
  initialEvents: readonly ActivityEventView[];
  assistant: string;
  buyerFirstName: string;
  notice: PreviewNotice | null;
}


const PAID_STATUSES: ReadonlySet<string> = new Set(["authorized", "capture_pending", "captured", "settling", "settled", "releasing"]);

function mergeEvents(current: readonly ActivityEventView[], incoming: ActivityEventView): ActivityEventView[] {
  return current.some((event) => event.seq === incoming.seq) ? [...current] : [...current, incoming].sort((a, b) => a.seq - b.seq);
}

/** Every item with who sells it and what the student pays, in the order the agent placed them. */
function ItemList({ items }: { items: readonly RoomItemData[] }) {
  return (
    <ol aria-label="Items in the room" className="flex flex-col">
      {items.map((item) => (
        <li key={item.layout.key} data-preview-item className="relative flex items-baseline justify-between gap-4 border-b border-hair py-2.5 last:border-b-0">
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">{item.title}</span>
            <span className="text-xs text-flint">
              {item.newFrom === undefined ? `${item.sellerName}, ${item.condition.toLowerCase()}${item.slotLabel === undefined ? "" : `, hands over ${item.slotLabel}`}` : `New, bought at ${item.newFrom.retailer}`}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end tabular-nums">
            <span className="text-sm font-semibold">{formatUsdShort(item.priceCents)}</span>
            {item.listPriceCents !== undefined && (
              <span className="text-xs text-flint">
                <span className="sr-only">asking price </span>
                <s>{formatUsdShort(item.listPriceCents)}</s>
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Whether the lead sentence sits clear of the strip the footer takes at the
 * bottom of a phone screen, or has scrolled away above it. The PayPal
 * footer sticks to the screen only then, so it never covers the sentence
 * that says what the page is.
 */
function useClearOfFooter(lead: RefObject<HTMLElement | null>, footer: RefObject<HTMLElement | null>, active: boolean): boolean {
  const [clear, setClear] = useState(false);
  useEffect(() => {
    if (!active) return;
    const check = () => {
      const sentence = lead.current;
      const strip = footer.current?.closest("[data-panel-footer]");
      if (sentence === null || !(strip instanceof HTMLElement)) return;
      setClear(sentence.getBoundingClientRect().bottom <= window.innerHeight - strip.offsetHeight);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    // The footer grows when PayPal's buttons and message arrive, which moves the strip it takes.
    const sizes = new ResizeObserver(check);
    const strip = footer.current?.closest("[data-panel-footer]");
    if (strip instanceof HTMLElement) sizes.observe(strip);
    if (lead.current !== null) sizes.observe(lead.current);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      sizes.disconnect();
    };
  }, [active, lead, footer]);
  return clear;
}

/**
 * A room an outside assistant planned over MCP, as the student sees it from
 * the preview link: the room in 3D, what is in it and from whom, the total,
 * and the PayPal button. The page follows the plan's activity while the
 * buyer agent still works, and nothing on it changes the room.
 */
export function PreviewScreen({ paypalClientId, holder, preset, initialPlan, initialEvents, assistant, buyerFirstName, notice }: PreviewScreenProps) {
  const router = useRouter();
  const [plan, setPlan] = useState<PlanView>(initialPlan);
  const [events, setEvents] = useState<readonly ActivityEventView[]>(initialEvents);
  const onPlan = useCallback((next: PlanView) => setPlan((current) => (current.id === next.id ? next : current)), []);
  const onEvent = useCallback((event: ActivityEventView) => setEvents((current) => mergeEvents(current, event)), []);
  usePlanStream(plan.id, events.at(-1)?.seq ?? 0, onPlan, onEvent);

  const running = plan.run?.status === "running";
  const checkout = plan.checkout;
  const paid = checkout !== null && PAID_STATUSES.has(checkout.status);
  const used = plan.items.filter((item) => item.newFrom === undefined);
  const added = plan.items.filter((item) => item.newFrom !== undefined);
  const sellers = new Set(used.map((item) => item.sellerName)).size;
  const payable = !running && !paid && used.length > 0;
  const lead = useRef<HTMLParagraphElement>(null);
  const pay = useRef<HTMLDivElement>(null);
  const footerSticks = useClearOfFooter(lead, pay, payable);

  // Approving from this page claims the plan through the session cookie the answer set, so the server render picks up who holds it.
  const onPaid = useCallback(
    (next: PlanView) => {
      setPlan(next);
      router.refresh();
    },
    [router],
  );

  const footer = paid ? (
    <div className="flex flex-col gap-4">
      <PaidPanel checkout={checkout} />
      {holder === "this_browser" ? (
        <HandoffLink planId={plan.id} checkout={checkout} />
      ) : (
        holder === "another_browser" && (
          <p data-preview-read-only className="text-sm text-flint">
            {buyerFirstName} approved this payment in another browser, which runs the handoff.
          </p>
        )
      )}
    </div>
  ) : payable ? (
    <div ref={pay} className="flex flex-col gap-3">
      <p className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-flint">
          {used.length} used {used.length === 1 ? "item" : "items"} through PayPal
        </span>
        <span className="text-xl font-semibold tabular-nums" data-footer-total={plan.usedCents}>
          {formatUsdShort(plan.usedCents)}
        </span>
      </p>
      <PayPalCheckout clientId={paypalClientId} planId={plan.id} amountCents={plan.usedCents} disabledReason={null} onPaid={onPaid} />
    </div>
  ) : undefined;

  return (
    <main className={SHELL_COLUMNS}>
      <section aria-label={`${plan.roomLabel}, the room`} className="min-w-0 lg:h-full lg:min-h-0">
        <RoomStage label={plan.roomLabel} preset={preset} items={plan.items} ring={running} showList={false} fill />
      </section>

      <UnderTheHoodProvider>
        <Panel
          id="preview-panel"
          heading="h1"
          sheet
          shell
          title={plan.roomLabel}
          subtitle={`Planned for ${buyerFirstName} over MCP`}
          action={<UnderTheHoodSwitch />}
          top={<StepStrip steps={BUYER_STEPS} current={paid ? 2 : running ? 0 : 1} label="Room progress" />}
          footer={footer}
          footerClassName={payable ? `${footerSticks ? "max-lg:sticky max-lg:bottom-0 max-lg:z-10" : ""} max-lg:border-t max-lg:border-hair max-lg:bg-paper max-lg:pb-[max(1rem,env(safe-area-inset-bottom))]` : ""}
        >
          <p ref={lead} data-preview-lead className="text-base">
            {assistant} asked Roomover to furnish this room for {formatUsdShort(plan.budgetCents)}. {paid ? "PayPal now holds the payment." : `Nothing is charged until you approve in PayPal.`}
          </p>
          {notice !== null && !paid && (
            <p role={notice.tone === "error" ? "alert" : "status"} className={`text-sm ${notice.tone === "error" ? "font-medium text-brick" : "text-flint"}`}>
              {notice.text}
            </p>
          )}
          {running && (
            <p role="status" className="flex items-center gap-2 text-sm text-flint">
              <Spinner className="size-3.5" />
              {plan.items.length === 0 ? "The buyer agent is reading the room" : `Placing items, ${plan.items.length} so far`}
            </p>
          )}
          {plan.items.length > 0 && <ItemList items={plan.items} />}
          {used.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-2xl font-semibold tabular-nums" data-total={plan.usedCents}>
                  {formatUsdShort(plan.usedCents)}
                </span>
                <span className="text-base text-flint">
                  through PayPal for {used.length} used {used.length === 1 ? "item" : "items"} from {sellers} {sellers === 1 ? "student" : "students"}
                </span>
              </p>
              {added.length > 0 && (
                <p className="text-sm text-flint tabular-nums">
                  Plus {formatUsdShort(plan.newItemsCents)} for {added.length === 1 ? "a new item" : `${added.length} new items`} from {added.length === 1 ? "its retailer" : "their retailers"}, {formatUsdShort(plan.totalCents)} of {formatUsdShort(plan.budgetCents)} in all
                </p>
              )}
              {plan.savings.savedCents > 0 && (
                <p data-savings className="text-sm text-flint">
                  {formatUsdShort(plan.savings.savedCents)} less than the cheapest comparable new items on Channel3
                </p>
              )}
            </div>
          )}
          {!running && plan.items.length === 0 && <p className="text-base">Nothing fit this room within the budget. Ask {assistantInSentence(assistant)} to plan it again with a larger budget.</p>}
          <section aria-labelledby="preview-activity" className="flex flex-col gap-3">
            <h2 id="preview-activity" className="text-sm font-semibold">
              What the agents did
            </h2>
            <ActivityFeed events={events} />
          </section>
          <UnderTheHoodLog negotiations={plan.negotiations} events={events} />
        </Panel>
      </UnderTheHoodProvider>
    </main>
  );
}
