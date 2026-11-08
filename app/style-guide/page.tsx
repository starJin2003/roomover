import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { ActivitySummary } from "@/components/activity/activity-summary";
import { ItemChecklist } from "@/components/handoff/item-checklist";
import { PayPalCard } from "@/components/paypal/paypal-card";
import { PayLaterMessageSlot, PayPalButtonSlot } from "@/components/paypal/sdk-slots";
import { UnderTheHoodProvider, UnderTheHoodSwitch } from "@/components/paypal/under-the-hood";
import { ScheduleSection } from "@/components/schedule/schedule-section";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { ChoiceKey } from "@/components/ui/choice-key";
import { FactList } from "@/components/ui/fact-list";
import { CurrencyField, TextAreaField, TextField } from "@/components/ui/field";
import { CameraIcon } from "@/components/ui/icons";
import { Panel } from "@/components/ui/panel";
import { PanelState } from "@/components/ui/panel-state";
import { PriceStepper } from "@/components/ui/price-stepper";
import { BUYER_STEPS, SELL_STEPS, StepStrip } from "@/components/ui/step-strip";
import { formatUsdShort } from "@/lib/format";
import { ACTIVITY_LOG, BUDGET_CENTS, FURNISH, HANDOFF, MONEY, PAYOUT_ARRIVALS, PAYPAL_MOMENTS, SELL, SELLER_PAYOUTS } from "./demo-data";
import { Colors, ContrastTable, MotionTokens, Shape, TypeScale } from "./foundations";
import { FurnishRoom, RoomPending } from "./room-section";
import { SellersPaidDemo } from "./sellers-paid-demo";

export const metadata: Metadata = {
  title: "Roomover style guide",
  description: "Components for the four Roomover screens and the tokens behind them.",
  robots: { index: false, follow: false },
};

const SECTIONS = [
  { id: "home", title: "Home" },
  { id: "furnish", title: "Furnish" },
  { id: "paypal", title: "PayPal moments" },
  { id: "handoff", title: "Handoff" },
  { id: "sell", title: "Sell" },
  { id: "keys", title: "Keys and states" },
  { id: "foundations", title: "Foundations" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function Section({ id, lead, children }: { id: SectionId; lead: string; children: ReactNode }) {
  const title = SECTIONS.find((section) => section.id === id)?.title;
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex scroll-mt-6 flex-col gap-8 py-12 sm:py-16">
      <div className="flex max-w-2xl flex-col gap-2">
        <h2 id={`${id}-heading`} className="text-xl font-semibold">
          {title}
        </h2>
        <p className="text-base text-flint">{lead}</p>
      </div>
      {children}
    </section>
  );
}

function Specimen({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-3 ${className}`}>
      <p className="text-sm text-flint">{label}</p>
      {children}
    </div>
  );
}

const KEY_VARIANTS: readonly { variant: ButtonVariant; label: string; busy: string; use: string }[] = [
  { variant: "primary", label: "Plan my room", busy: "Planning", use: "The one primary action on a screen" },
  { variant: "secondary", label: "Use a different photo", busy: "Opening camera", use: "Actions beside the primary one" },
  { variant: "quiet", label: "Ask for changes", busy: "Sending", use: "Low emphasis actions inside panels" },
  { variant: "destructive", label: "Remove listing", busy: "Removing", use: "Actions that remove something" },
];

const KEY_STATES = ["Default", "Hover", "Pressed", "Focus", "Disabled", "Loading"] as const;

const PREVIEW: Partial<Record<(typeof KEY_STATES)[number], string>> = { Hover: "hover", Pressed: "press", Focus: "focus" };

function KeyMatrix() {
  return (
    <div className="flex flex-col gap-8">
      {KEY_VARIANTS.map((key) => (
        <div key={key.variant} className="flex flex-col gap-3">
          <div>
            <p className="text-base font-semibold capitalize">{key.variant}</p>
            <p className="text-sm text-flint">{key.use}</p>
          </div>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {KEY_STATES.map((state) => (
              <li key={state} className="flex flex-col items-start gap-2">
                <span className="text-xs text-flint">{state}</span>
                <Button
                  variant={key.variant}
                  size="sm"
                  data-preview={PREVIEW[state]}
                  disabled={state === "Disabled"}
                  loadingLabel={state === "Loading" ? key.busy : undefined}
                >
                  {key.label}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function StyleGuidePage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-16 sm:px-10">
      <header className="flex flex-col gap-6 pt-6">
        <div className="flex items-center justify-between gap-4">
          <span className="text-lg font-semibold">Roomover</span>
          <span className="text-sm text-flint">Draft for approval</span>
        </div>
        <div className="flex max-w-3xl flex-col gap-4 pt-6 sm:pt-12">
          <h1 className="text-2xl font-semibold sm:text-3xl">Roomover style guide</h1>
          <p className="text-base text-flint sm:text-lg">
            Components for the four screens. The table is the ground, Paper sheets sit on it, keys stand on a skirt, and PayPal navy
            and blue appear only where money moves.
          </p>
        </div>
        <nav aria-label="Style guide sections">
          <ul className="flex flex-wrap gap-x-5">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="inline-flex min-h-11 items-center text-sm font-medium text-flint hover:text-ink">
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main>
        <Section id="home" lead="Two choices, one for each job.">
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            <ChoiceKey href="#furnish" tone="primary" title="Furnish a room" description="Agents pick items that fit your room and budget" />
            <ChoiceKey href="#sell" title="Sell items" description="Take a photo and we fill in the price" />
          </div>
        </Section>

        <Section id="furnish" lead="The room fills on the table while the panel tells the story in three sentences. The PayPal approval happens on this screen.">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-start lg:gap-12">
            <Suspense fallback={<RoomPending />}>
              <FurnishRoom label={FURNISH.room} />
            </Suspense>
            <Panel id="furnish-panel" title={FURNISH.room} subtitle={FURNISH.subtitle}>
              <StepStrip steps={BUYER_STEPS} current={1} label="Furnish progress" />
              <ActivitySummary sentences={FURNISH.sentences} log={ACTIVITY_LOG} />
              <div className="flex flex-col gap-1">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-2xl font-semibold tabular-nums">{formatUsdShort(MONEY.authorizedCents)}</span>
                  <span className="text-base text-flint">of your {formatUsdShort(BUDGET_CENTS)}</span>
                </p>
                <p className="text-sm text-flint">{formatUsdShort(MONEY.newCents - MONEY.authorizedCents)} less than buying these new</p>
              </div>
              <div className="flex flex-col gap-3">
                <PayPalButtonSlot />
                <PayLaterMessageSlot amountCents={MONEY.authorizedCents} />
              </div>
            </Panel>
          </div>
        </Section>

        <Section
          id="paypal"
          lead="The navy card appears only when money is held, captured, or paid out. Under the hood adds the PayPal API and sandbox ID behind each step."
        >
          <UnderTheHoodProvider>
            <Panel id="paypal-moments" title="Money moments" subtitle="Sandbox IDs are placeholders until checkout runs" action={<UnderTheHoodSwitch />}>
              <div className="grid gap-6 md:grid-cols-3">
                <Specimen label="Held, after approval and while checking">
                  <PayPalCard {...PAYPAL_MOMENTS.heldAfterApproval} />
                </Specimen>
                <Specimen label="Captured, when the last item passes">
                  <PayPalCard {...PAYPAL_MOMENTS.captured} />
                </Specimen>
                <Specimen label="Sellers paid, when the payout lands">
                  <PayPalCard {...PAYPAL_MOMENTS.paid} />
                </Specimen>
              </div>
            </Panel>
          </UnderTheHoodProvider>
        </Section>

        <Section id="handoff" lead="Check each item with a photo. When the last one passes, the sellers paid result appears on the same screen.">
          <div className="grid items-start gap-8 lg:grid-cols-2">
            <UnderTheHoodProvider>
              <Panel id="handoff-checking" title="Handoff" subtitle={HANDOFF.subtitle} action={<UnderTheHoodSwitch />}>
                <StepStrip steps={BUYER_STEPS} current={2} label="Handoff progress" />
                <p className="text-sm text-flint">Take a photo of each item. Roomover compares it with the seller&apos;s photos.</p>
                <ItemChecklist items={HANDOFF.items} />
                <PayPalCard {...PAYPAL_MOMENTS.heldAtHandoff} />
                <Button className="w-full">
                  <CameraIcon />
                  Add a photo of the bean bag
                </Button>
              </Panel>
            </UnderTheHoodProvider>
            <UnderTheHoodProvider>
              <Panel id="handoff-done" title="Handoff done" subtitle="Mon, Nov 23, all 5 items checked" action={<UnderTheHoodSwitch />}>
                <StepStrip steps={BUYER_STEPS} current={3} label="Handoff progress" />
                <SellersPaidDemo payouts={SELLER_PAYOUTS} arrivals={PAYOUT_ARRIVALS} />
                <PayPalCard {...PAYPAL_MOMENTS.paid} />
                <Button className="w-full">Done</Button>
              </Panel>
            </UnderTheHoodProvider>
          </div>
          <ScheduleSection description="When each seller moves out, when Jordan moves in, and the handoff slot the agents agreed on" />
        </Section>

        <Section id="sell" lead="The photo fills in the title, price, and details. One key lists the item.">
          <Panel id="sell-panel" title={SELL.title} subtitle="Filled in from your photo. Change anything that looks off." className="max-w-[440px]">
            <StepStrip steps={SELL_STEPS} current={1} label="Listing progress" />
            <PriceStepper
              id="sell-price"
              label="Your price"
              defaultCents={SELL.priceCents}
              minCents={SELL.floorCents}
              aside={`New about ${formatUsdShort(SELL.newCents)}`}
              name="priceCents"
            />
            <FactList facts={SELL.facts} />
            <Button className="w-full">List for {formatUsdShort(SELL.priceCents)}</Button>
          </Panel>
        </Section>

        <Section id="keys" lead="Pressable things stand on a skirt and travel down when pressed. A disabled key loses its skirt.">
          <KeyMatrix />
          <div className="grid gap-6 lg:grid-cols-3">
            <Panel id="state-empty" title="Activity" subtitle="Harbor Hall 214, before planning">
              <PanelState
                kind="empty"
                title="No items placed yet"
                body="Describe the room you want, and the buyer agent starts placing items from 24 listings."
                action={<Button size="sm">Plan my room</Button>}
              />
            </Panel>
            <Panel id="state-loading" title="Activity" subtitle="Harbor Hall 214, planning">
              <PanelState kind="loading" title="Searching listings" body="The buyer agent is checking 24 listings against Harbor Hall rules and your $150 budget." />
            </Panel>
            <Panel id="state-error" title="Activity" subtitle="Harbor Hall 214, connection lost">
              <PanelState
                kind="error"
                title="The activity feed disconnected"
                body="The connection to the agent run dropped after 14 events. Items already placed stay in your room."
                action={
                  <Button variant="secondary" size="sm">
                    Reconnect
                  </Button>
                }
              />
            </Panel>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel id="fields-ready" title="Fields">
              <TextAreaField id="prompt-ready" label="What should your room feel like?" defaultValue="$150, cozy, I study late" help="Include a budget and how you use the room." />
              <TextField id="title-ready" label="Listing title" defaultValue={SELL.title} help="Buyers see this first." />
            </Panel>
            <Panel id="fields-error" title="Fields with errors">
              <TextAreaField id="prompt-error" label="What should your room feel like?" defaultValue="cozy, I study late" error="Add a budget in dollars, for example $150." />
              <CurrencyField id="price-error" label="Lowest you'll take" defaultValue="18.00" error="Set this at or below your price of $16." />
            </Panel>
          </div>
        </Section>

        <Section id="foundations" lead="Eight palette colors, five surfaces mixed from them, seven type sizes, and three weights.">
          <Colors />
          <ContrastTable />
          <TypeScale />
          <Shape />
          <MotionTokens />
        </Section>
      </main>
    </div>
  );
}
