import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ActivityPanel } from "@/components/activity/activity-panel";
import { SettlementLedger } from "@/components/ledger/settlement-ledger";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { CurrencyField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { ListingCard } from "@/components/ui/listing-card";
import { PanelState } from "@/components/ui/panel-state";
import { PayPalButtonSlot } from "@/components/ui/paypal-button-slot";
import { StatusChip } from "@/components/ui/status-chip";
import {
  DISPUTE_STATUS_DISPLAY,
  LISTING_STATUS_DISPLAY,
  orderItemStatusDisplay,
  PAYOUT_ITEM_STATUS_DISPLAY,
  type StatusDisplay,
} from "@/lib/design/status";
import { LISTING_STATUSES, ORDER_ITEM_STATUSES, PAYOUT_ITEM_STATUSES } from "@/lib/domain/enums";
import { formatUsd } from "@/lib/format";
import { ACTIVITY, CARD_SLUGS, LEDGER, LEDGER_SUMMARY, listingCard } from "./demo-data";
import { ColorSwatches, ContrastTable, MotionTokens, SpaceAndShape, TypeScale } from "./foundations";
import { MotionDemo } from "./motion-demo";

export const metadata: Metadata = {
  title: "Roomover style guide",
  description: "Tokens and components for every Roomover screen and the 3D room.",
  robots: { index: false, follow: false },
};

const SECTIONS = [
  { id: "color", title: "Color" },
  { id: "type", title: "Type" },
  { id: "space", title: "Space and shape" },
  { id: "motion", title: "Motion" },
  { id: "buttons", title: "Buttons" },
  { id: "fields", title: "Form fields" },
  { id: "status", title: "Status chips" },
  { id: "listing", title: "Listing card" },
  { id: "activity", title: "Activity panel" },
  { id: "ledger", title: "Ledger" },
  { id: "states", title: "Panel states" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function Section({ id, lead, children }: { id: SectionId; lead: string; children: ReactNode }) {
  const title = SECTIONS.find((section) => section.id === id)?.title;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 border-t border-stone/50 pt-10 pb-16 sm:pt-12 sm:pb-20">
      <h2 id={`${id}-title`} className="text-xl font-extrabold tracking-tight sm:text-2xl">
        {title}
      </h2>
      <p className="mt-2 max-w-2xl text-base text-flint sm:text-md">{lead}</p>
      <div className="mt-8 sm:mt-10">{children}</div>
    </section>
  );
}

const BUTTONS: readonly { variant: ButtonVariant; label: string; busy: string; use: string }[] = [
  { variant: "primary", label: "Plan my room", busy: "Planning", use: "The one main action on a screen." },
  { variant: "secondary", label: "Save draft", busy: "Saving", use: "Actions beside the main one." },
  { variant: "quiet", label: "View hall rules", busy: "Opening rules", use: "Low emphasis actions inside panels and lists." },
  {
    variant: "destructive",
    label: "Release item",
    busy: "Releasing",
    use: "Actions that give money back or remove something, such as releasing an item to the buyer.",
  },
];

const BUTTON_STATES = ["Default", "Hover", "Focus", "Disabled", "Loading"] as const;

function ButtonMatrix() {
  return (
    <div className="flex flex-col gap-8">
      {BUTTONS.map((button) => (
        <div key={button.variant} className="flex flex-col gap-4">
          <div>
            <p className="text-md font-semibold capitalize">{button.variant}</p>
            <p className="text-sm text-flint">{button.use}</p>
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
            {BUTTON_STATES.map((state) => (
              <li key={state} className="flex flex-col items-start gap-2">
                <span className="text-xs text-flint">{state}</span>
                <Button
                  variant={button.variant}
                  data-preview={state === "Hover" ? "hover" : state === "Focus" ? "focus" : undefined}
                  disabled={state === "Disabled"}
                  loadingLabel={state === "Loading" ? button.busy : undefined}
                >
                  {button.label}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="flex flex-col gap-4 border-t border-stone/50 pt-8">
        <div>
          <p className="text-md font-semibold text-navy">PayPal approval</p>
          <p className="text-sm text-flint">One approval pays every seller in the cart.</p>
        </div>
        <PayPalButtonSlot />
      </div>
    </div>
  );
}

const ROOMS = [
  { value: "harbor-hall-double", label: "Harbor Hall double, 3.6 by 4.5 m" },
  { value: "birchwood-house-single", label: "Birchwood House single, 2.8 by 3.6 m" },
  { value: "breakwater-apartments-bedroom", label: "Breakwater Apartments bedroom, 2.7 by 4.6 m" },
];

function FormFields() {
  return (
    <div className="grid gap-12 lg:grid-cols-2">
      <div className="flex flex-col gap-6">
        <p className="text-md font-semibold">Ready</p>
        <TextField
          id="title-ready"
          label="Listing title"
          defaultValue="Black balance arm desk lamp"
          help="Buyers see this first. Name the item and one detail."
        />
        <CurrencyField id="price-ready" label="Price" defaultValue="16.00" help="Agents never accept less than your floor price of $12.00." />
        <SelectField
          id="room-ready"
          label="Room you are moving into"
          options={ROOMS}
          defaultValue="harbor-hall-double"
          help="The buyer agent reads its size and hall rules."
        />
        <TextAreaField
          id="prompt-ready"
          label="What should your room feel like?"
          defaultValue="$150, cozy, I study late"
          help="Include a budget and how you use the room."
        />
      </div>
      <div className="flex flex-col gap-6">
        <p className="text-md font-semibold">With errors</p>
        <TextField id="title-error" label="Listing title" defaultValue="" error="Add a title so buyers know what the item is." />
        <CurrencyField
          id="price-error"
          label="Price"
          defaultValue="9.00"
          help="Agents never accept less than your floor price of $12.00."
          error="Set a price at or above your floor price of $12.00."
        />
        <SelectField
          id="room-error"
          label="Room you are moving into"
          options={ROOMS}
          placeholder="Choose a room"
          defaultValue=""
          error="Choose the room you are moving into."
        />
        <TextAreaField
          id="prompt-error"
          label="What should your room feel like?"
          defaultValue="cozy, I study late"
          error="Add a budget in dollars, for example $150."
        />
      </div>
    </div>
  );
}

const TONE_LEGEND: readonly { status: StatusDisplay; meaning: string }[] = [
  { status: { label: "Blue fill", tone: "moved" }, meaning: "Money moved" },
  { status: { label: "Blue outline", tone: "held" }, meaning: "PayPal holds the money or is about to move it" },
  { status: { label: "Dashed", tone: "released" }, meaning: "Released with no transfer" },
  { status: { label: "Brick", tone: "alert" }, meaning: "Someone has to act" },
  { status: { label: "Outline", tone: "neutral" }, meaning: "No money involved" },
];

function uniqueByLabel(statuses: readonly StatusDisplay[]): StatusDisplay[] {
  return statuses.filter((status, index) => statuses.findIndex((other) => other.label === status.label) === index);
}

const STATUS_GROUPS: readonly { title: string; statuses: readonly StatusDisplay[] }[] = [
  { title: "Listings", statuses: LISTING_STATUSES.map((status) => LISTING_STATUS_DISPLAY[status]) },
  {
    title: "Order items",
    statuses: uniqueByLabel([
      ...ORDER_ITEM_STATUSES.map((status) => orderItemStatusDisplay(status, "authorize_then_capture")),
      orderItemStatusDisplay("released", "capture_at_checkout"),
    ]),
  },
  { title: "Payouts", statuses: PAYOUT_ITEM_STATUSES.map((status) => PAYOUT_ITEM_STATUS_DISPLAY[status]) },
  { title: "Disputes", statuses: uniqueByLabel(Object.values(DISPUTE_STATUS_DISPLAY)) },
];

function StatusChips() {
  return (
    <div className="flex flex-col gap-10">
      <ul className="flex flex-col gap-3">
        {TONE_LEGEND.map((entry) => (
          <li key={entry.status.tone} className="grid grid-cols-[128px_minmax(0,1fr)] items-center gap-4 text-sm">
            <span>
              <StatusChip status={entry.status} />
            </span>
            <span className="text-flint">{entry.meaning}</span>
          </li>
        ))}
      </ul>
      <div className="grid gap-8 md:grid-cols-2">
        {STATUS_GROUPS.map((group) => (
          <div key={group.title} className="flex flex-col gap-3">
            <p className="text-md font-semibold">{group.title}</p>
            <ul className="flex flex-wrap gap-2">
              {group.statuses.map((status) => (
                <li key={status.label}>
                  <StatusChip status={status} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StyleGuidePage() {
  const lamp = listingCard("ava-desk-lamp");
  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-10">
      <header className="pb-12 sm:pb-16">
        <div className="flex items-center justify-between gap-4 py-6">
          <span className="text-lg font-black tracking-tight">Roomover</span>
          <span className="text-sm text-flint">Draft for approval</span>
        </div>
        <h1 className="mt-8 max-w-4xl text-3xl font-black tracking-tight sm:mt-16 sm:text-4xl">Roomover style guide</h1>
        <p className="mt-5 max-w-2xl text-md text-flint sm:text-lg">
          Every screen and the 3D room draw from these tokens and components. PayPal blue marks the moments when money moves,
          and nowhere else.
        </p>
      </header>

      <div className="lg:grid lg:grid-cols-[176px_minmax(0,1fr)] lg:gap-16">
        <nav aria-label="Style guide sections" className="pb-10 lg:sticky lg:top-6 lg:self-start lg:pb-0">
          <ul className="flex flex-wrap gap-x-4 gap-y-2 lg:flex-col lg:gap-2.5">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="text-sm font-medium text-flint underline-offset-4 hover:text-ink hover:underline">
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0">
          <Section
            id="color"
            lead="Six colors come from the PayPal monogram. Flint carries secondary text because Stone fails AA at body size, and Brick marks errors."
          >
            <div className="flex flex-col gap-14">
              <ColorSwatches />
              <ContrastTable />
            </div>
          </Section>

          <Section
            id="type"
            lead="Recursive by Arrow Type, licensed under the SIL Open Font License 1.1 and served from this app. One family covers headings, body, and the codes PayPal returns."
          >
            <TypeScale />
          </Section>

          <Section id="space" lead="A 4 px grid for spacing. Small controls get small radii, and panels get the largest.">
            <SpaceAndShape />
          </Section>

          <Section
            id="motion"
            lead="Motion answers something that happened. An item lands in the room, a key goes down, a balance changes. Nothing loops or moves on page load, and reduced motion turns it all off."
          >
            <div className="flex flex-col gap-8">
              <MotionTokens />
              <MotionDemo itemLabel="Desk lamp" sellerName={lamp.sellerName} payoutCents={lamp.priceCents} />
            </div>
          </Section>

          <Section
            id="buttons"
            lead="Things you can press stand on a key edge and travel down when pressed. Disabled buttons lose the edge. The PayPal approve action is always the official SDK button."
          >
            <ButtonMatrix />
          </Section>

          <Section id="fields" lead="Every field has a visible label. Help text says what happens with the value, and errors say how to fix it.">
            <FormFields />
          </Section>

          <Section
            id="status"
            lead="One chip shape for listings, order items, payouts, and disputes. The fill tells you whether money moved, and the label always says the state in words."
          >
            <StatusChips />
          </Section>

          <Section id="listing" lead="Real seed listings. Size shows inches with centimeters under them, and the new price shows what buying used saves.">
            <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {CARD_SLUGS.map((slug) => (
                <li key={slug}>
                  <ListingCard listing={listingCard(slug)} />
                </li>
              ))}
            </ul>
          </Section>

          <Section
            id="activity"
            lead="Each line names the agent, the tool, and what happened. PayPal steps carry a blue rule, the API name, and the sandbox ID they returned. The IDs here are placeholders until checkout runs."
          >
            <div className="max-w-3xl">
              <ActivityPanel id="activity-demo" title="Activity" subtitle="Harbor Hall 214 for Jordan Ellis, $150 budget" entries={ACTIVITY} />
            </div>
          </Section>

          <Section id="ledger" lead="Balances before and after one settlement. Money only changes hands, so the totals match.">
            <div className="max-w-3xl">
              <SettlementLedger
                title="Settlement for Harbor Hall 214"
                subtitle={`Captured ${formatUsd(LEDGER_SUMMARY.capturedCents)} of ${formatUsd(LEDGER_SUMMARY.authorizedCents)} authorized. The other ${formatUsd(LEDGER_SUMMARY.releasedCents)} went back to Jordan.`}
                rows={LEDGER}
                footnote={`Demo data. Payouts batch ${LEDGER_SUMMARY.batchId} is a placeholder until settlement runs in the sandbox, and balances come from the Roomover ledger.`}
              />
            </div>
          </Section>

          <Section id="states" lead="A panel with nothing yet invites the next step. A waiting panel says what it waits for, and a failed panel says what broke and what still holds.">
            <div className="grid gap-6 lg:grid-cols-3">
              <ActivityPanel
                id="state-empty"
                title="Activity"
                subtitle="Harbor Hall 214, before planning"
                state={
                  <PanelState
                    kind="empty"
                    title="No items placed yet"
                    body="Describe the room you want, and the buyer agent starts placing items from 24 listings."
                    action={<Button>Plan my room</Button>}
                  />
                }
              />
              <ActivityPanel
                id="state-loading"
                title="Activity"
                subtitle="Harbor Hall 214, planning"
                state={
                  <PanelState
                    kind="loading"
                    title="Searching listings"
                    body="The buyer agent is checking 24 listings against Harbor Hall rules and your $150 budget."
                  />
                }
              />
              <ActivityPanel
                id="state-error"
                title="Activity"
                subtitle="Harbor Hall 214, connection lost"
                state={
                  <PanelState
                    kind="error"
                    title="The activity feed disconnected"
                    body="The connection to the agent run dropped after 14 events. Items already placed stay in your room."
                    action={<Button variant="secondary">Reconnect</Button>}
                  />
                }
              />
            </div>
          </Section>
        </main>
      </div>
    </div>
  );
}
