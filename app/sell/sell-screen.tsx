"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PayPalLoginKey } from "@/components/paypal/paypal-login";
import { UnderTheHoodProvider, UnderTheHoodSwitch } from "@/components/paypal/under-the-hood";
import { preparePhoto } from "@/components/photos/prepare-photo";
import { PhotoPlate } from "@/components/sell/photo-plate";
import { SellProgress, type ProgressStep } from "@/components/sell/sell-progress";
import { SellUnderTheHood } from "@/components/sell/sell-under-the-hood";
import { SimilarProducts } from "@/components/sell/similar-products";
import { sizeFromInches, SizeFields, sizeTextFromMm, type SizeText } from "@/components/sell/size-fields";
import { SHELL_COLUMNS } from "@/components/site/screen-frame";
import { Button } from "@/components/ui/button";
import { ChoiceGroup, type Choice } from "@/components/ui/choice-group";
import { FactList } from "@/components/ui/fact-list";
import { Panel } from "@/components/ui/panel";
import { PanelState } from "@/components/ui/panel-state";
import { PriceStepper } from "@/components/ui/price-stepper";
import { SELL_STEPS, StepStrip } from "@/components/ui/step-strip";
import type { HandoffMode } from "@/lib/domain/enums";
import { minFloorCents } from "@/lib/domain/pricing";
import type { MoveOutTerm } from "@/lib/domain/sell";
import { formatInches, formatUsdShort } from "@/lib/format";
import { SELL_SAMPLES } from "@/lib/sell/samples";
import type { SellDraftView, SellView } from "@/lib/sell/view";
import { sourceSentence } from "@/lib/sell/words";

interface SellScreenProps {
  /** Null until the seller logs in with PayPal. */
  initialView: SellView | null;
  /** Why the last Log in with PayPal did not finish, in a sentence. */
  loginNote: string | null;
}

type Work = { kind: "idle" } | { kind: "matching"; preview: string } | { kind: "describing" } | { kind: "listing" };

const HANDOFF_WORDS: Readonly<Record<HandoffMode, { title: string; description: string }>> = {
  direct: { title: "Hand it over yourself", description: "You meet the next student while you are both on campus" },
  storage_hold: { title: "Campus storage", description: "You drop it at storage, and the next student collects it on arrival" },
  same_room: { title: "Leave it in your room", description: "The next student moves into your room and finds it there" },
};

/** Where PayPal pays this seller: the payer ID Log in with PayPal shared, or else the account's email. */
function payoutWords(payerIdLast4: string | null): string {
  return payerIdLast4 === null ? "Payouts go to the email on the PayPal account you logged in with." : `Payouts go to the PayPal account with payer ID ending ${payerIdLast4}.`;
}

async function readAnswer(response: Response): Promise<{ view?: SellView; error?: string }> {
  try {
    return (await response.json()) as { view?: SellView; error?: string };
  } catch {
    return { error: "The server did not answer. Try again in a moment." };
  }
}

function progressSteps(draft: SellDraftView | null, work: Work): ProgressStep[] {
  const searching = work.kind === "matching";
  const channel3: ProgressStep =
    draft === null || searching
      ? { key: "channel3", text: "Channel3 is looking for this product in retail catalogs", state: "working" }
      : {
          key: "channel3",
          text:
            draft.channel3.unavailable ??
            (draft.channel3.candidateCount === 0 ? "Channel3 found no product like it" : `Channel3 found ${draft.channel3.candidateCount === 1 ? "1 product" : `${draft.channel3.candidateCount} products`} like it`),
          state: "done",
        };
  const claude: ProgressStep = {
    key: "claude",
    text: draft?.status === "ready" ? "Claude read the item and its condition" : "Claude is reading the item, its condition, and the match",
    state: draft === null || searching ? "waiting" : draft.status === "ready" ? "done" : "working",
  };
  return [channel3, claude];
}

const STICKY_FOOTER = "max-lg:sticky max-lg:bottom-0 max-lg:z-10 max-lg:border-t max-lg:border-hair max-lg:bg-paper max-lg:pb-[max(1rem,env(safe-area-inset-bottom))]";

interface SellPanelProps {
  title: string;
  subtitle: string;
  step: number;
  /** Shows the Developer view switch once there is something behind the listing to show. */
  hood: boolean;
  footer: ReactNode;
  children: ReactNode;
}

/** The Sell panel, the same sheet in every step, with the step's primary action pinned under it. */
function SellPanel({ title, subtitle, step, hood, footer, children }: SellPanelProps) {
  return (
    <Panel
      id="sell-panel"
      heading="h1"
      sheet
      shell
      title={title}
      subtitle={subtitle}
      action={hood ? <UnderTheHoodSwitch /> : undefined}
      top={<StepStrip steps={SELL_STEPS} current={step} label="Listing progress" />}
      footer={footer}
      footerClassName={STICKY_FOOTER}
    >
      {children}
    </Panel>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error === null ? null : (
    <p role="alert" className="text-sm font-medium text-brick">
      {error}
    </p>
  );
}

export interface ListRequest {
  priceCents: number;
  floorPriceCents: number;
  sizeMm: { widthMm: number; depthMm: number; heightMm: number } | null;
  moveOut: MoveOutTerm;
  handoffMode: HandoffMode;
}

interface DetailsPanelProps {
  view: SellView;
  draft: SellDraftView;
  details: NonNullable<SellDraftView["details"]>;
  subtitle: string;
  listing: boolean;
  error: string | null;
  onList: (input: ListRequest) => void;
  onNewPhoto: () => void;
}

/** The filled in listing. The seller can move both prices inside their bounds, enter a size, and choose when and how it hands over. */
function DetailsPanel({ view, draft, details, subtitle, listing, error, onList, onNewPhoto }: DetailsPanelProps) {
  const [price, setPrice] = useState(details.priceCents);
  const [floor, setFloor] = useState(details.floorPriceCents);
  const suggestedSize = draft.similar?.sizeMm ?? null;
  const [size, setSize] = useState<SizeText>(suggestedSize === null ? { width: "", depth: "", height: "" } : sizeTextFromMm(suggestedSize));
  const [sizeError, setSizeError] = useState<string | undefined>(undefined);
  const [term, setTerm] = useState<MoveOutTerm>("this_term");
  const [mode, setMode] = useState<HandoffMode>("direct");

  const options = view.moveOut.find((option) => option.term === term) ?? view.moveOut[0];
  const modes = Object.keys(HANDOFF_WORDS) as HandoffMode[];
  const closedReason = (candidate: HandoffMode) =>
    candidate === "same_room" && view.seller.roomLabel === null ? "Roomover has no room on file for you" : options.modes[candidate] === null ? "Nobody moves in until fall, months after you leave" : null;
  const chosenMode = closedReason(mode) === null ? mode : (modes.find((candidate) => closedReason(candidate) === null) ?? "storage_hold");
  // Each term shows the move out dates of the handoff chosen below, or of storage where that handoff cannot serve the term.
  const termChoices: Choice<MoveOutTerm>[] = view.moveOut.map((option) => ({ value: option.term, title: option.label, description: `Moving out ${option.modes[mode] ?? option.modes.storage_hold ?? ""}` }));
  const modeChoices: Choice<HandoffMode>[] = modes.map((candidate) => ({
    value: candidate,
    title: HANDOFF_WORDS[candidate].title,
    description: candidate === "same_room" && view.seller.roomLabel !== null ? `The next student moves into ${view.seller.roomLabel} and finds it there` : HANDOFF_WORDS[candidate].description,
    disabledReason: closedReason(candidate),
  }));

  const changePrice = (cents: number) => {
    setPrice(cents);
    setFloor((current) => Math.min(Math.max(current, minFloorCents(cents)), cents));
  };
  const list = () => {
    const sizeMm = details.sizeMm === null ? sizeFromInches(size) : null;
    if (details.sizeMm === null && sizeMm === null) {
      setSizeError("Enter the width, depth, and height in inches, so the buyer agent can check it fits a room.");
      return;
    }
    setSizeError(undefined);
    onList({ priceCents: price, floorPriceCents: floor, sizeMm, moveOut: term, handoffMode: chosenMode });
  };

  return (
    <SellPanel
      title="Check the details"
      subtitle={subtitle}
      step={1}
      hood
      footer={
        <>
          <ErrorLine error={error} />
          <Button className="w-full" onClick={list} loadingLabel={listing ? "Listing" : undefined}>
            List for {formatUsdShort(price)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-balance">{details.title}</h2>
        <p className="text-sm text-flint">{sourceSentence(draft)}</p>
      </div>
      {draft.similar !== null && <SimilarProducts products={draft.similar.products} />}
      <PriceStepper id="sell-price" label="Your price" value={price} onChange={changePrice} minCents={details.minPriceCents} maxCents={details.maxPriceCents} aside={`New about ${formatUsdShort(details.newPriceCents)}`} />
      <PriceStepper id="sell-floor" label="Lowest you'll take" value={floor} onChange={setFloor} minCents={minFloorCents(price)} maxCents={price} aside="The buyer agent never offers less" />
      <FactList
        facts={[
          { label: "Condition", value: details.condition },
          ...(details.defects.length === 0 ? [] : [{ label: "Wear", value: details.defects.join(". ") }]),
          { label: "Color", value: details.colorName },
          ...(details.sizeMm === null ? [] : [{ label: "Size, from Channel3", value: formatInches(details.sizeMm) }]),
        ]}
      />
      {details.sizeMm === null && (
        <SizeFields
          value={size}
          onChange={(next) => {
            setSize(next);
            setSizeError(undefined);
          }}
          error={sizeError}
          note={suggestedSize === null ? undefined : "From a similar item. Check before you list."}
        />
      )}
      <ChoiceGroup name="move-out" legend="When you leave" choices={termChoices} value={term} onChange={setTerm} />
      <ChoiceGroup name="handoff-mode" legend="How the next student gets it" choices={modeChoices} value={chosenMode} onChange={setMode} />
      <p className="text-sm text-flint">{details.description}</p>
      <SellUnderTheHood draft={draft} payerIdLast4={view.seller.payerIdLast4} />
      <Button variant="quiet" size="sm" className="self-start" onClick={onNewPhoto} disabled={listing}>
        Use a different photo
      </Button>
    </SellPanel>
  );
}

export function SellScreen({ initialView, loginNote }: SellScreenProps) {
  const [view, setView] = useState(initialView);
  const [work, setWork] = useState<Work>({ kind: "idle" });
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const resumed = useRef<string | null>(null);

  const draft = fresh ? null : (view?.draft ?? null);

  const describe = useCallback(async (draftId: string) => {
    setWork({ kind: "describing" });
    try {
      const response = await fetch(`/api/sell/drafts/${draftId}/describe`, { method: "POST" });
      const answer = await readAnswer(response);
      if (answer.view !== undefined) setView(answer.view);
      if (!response.ok) setError(answer.error ?? "The seller agent did not finish. Try again.");
    } catch {
      setError("Roomover could not reach the server. Try again in a moment.");
    } finally {
      setWork({ kind: "idle" });
    }
  }, []);

  // A reload between Channel3 and the seller agent picks the photo up where it stopped.
  useEffect(() => {
    if (draft === null || draft.status !== "matched" || work.kind !== "idle" || resumed.current === draft.id) return;
    resumed.current = draft.id;
    void describe(draft.id);
  }, [draft, work.kind, describe]);

  const start = async (body: BodyInit, headers: HeadersInit | undefined, preview: string) => {
    setError(null);
    setWork({ kind: "matching", preview });
    try {
      const response = await fetch("/api/sell/drafts", { method: "POST", body, headers });
      const answer = (await readAnswer(response)) as { view?: SellView; error?: string; draftId?: string };
      if (answer.view !== undefined) setView(answer.view);
      if (!response.ok || answer.draftId === undefined) {
        setError(answer.error ?? "That photo did not go through. Try again.");
        setWork({ kind: "idle" });
        return;
      }
      setFresh(false);
      resumed.current = answer.draftId;
      await describe(answer.draftId);
    } catch {
      setError("Roomover could not reach the server. Try again in a moment.");
      setWork({ kind: "idle" });
    }
  };
  const onFile = async (file: File) => {
    const form = new FormData();
    form.append("photo", await preparePhoto(file), "listing.jpg");
    void start(form, undefined, URL.createObjectURL(file));
  };
  const onSample = (slug: string, src: string) => void start(JSON.stringify({ sample: slug }), { "Content-Type": "application/json" }, src);

  const onList = async (input: ListRequest) => {
    if (draft === null) return;
    setError(null);
    setWork({ kind: "listing" });
    try {
      const response = await fetch(`/api/sell/drafts/${draft.id}/listing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const answer = await readAnswer(response);
      if (answer.view !== undefined) setView(answer.view);
      if (!response.ok) setError(answer.error ?? "The listing did not go through. Try again.");
    } catch {
      setError("Roomover could not reach the server. Try again in a moment.");
    } finally {
      setWork({ kind: "idle" });
    }
  };
  const newPhoto = () => {
    setError(null);
    setFresh(true);
  };

  const fileInput = (
    <input
      ref={picker}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      capture="environment"
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file !== undefined) void onFile(file);
      }}
    />
  );
  const pick = () => picker.current?.click();

  if (view === null) {
    return (
      <main className={SHELL_COLUMNS}>
        <section aria-label="Your photo" className="min-w-0 lg:h-full lg:min-h-0">
          <PhotoPlate photo={null} emptyText="One photo of the item is all Roomover needs" preview={SELL_SAMPLES} />
        </section>
        <SellPanel title="Sell an item" subtitle="For Lakeshore students moving out" step={0} hood={false} footer={<PayPalLoginKey />}>
          {loginNote !== null && <PanelState kind="error" title="You are not signed in" body={loginNote} />}
          <p className="text-base">Log in with PayPal first. PayPal pays you through that account after the next student checks your item at handoff.</p>
          <p className="text-sm text-flint">Then take one photo. Claude reads what it is and its condition, Channel3 finds it in retail catalogs for its size and new price, and the seller agent suggests a fair used price.</p>
          <p className="text-sm text-flint">This demo runs in the PayPal sandbox. Log in with a sandbox personal account, such as the seller account in the README.</p>
        </SellPanel>
      </main>
    );
  }

  const working = work.kind === "matching" || work.kind === "describing";
  const photo = work.kind === "matching" ? { src: work.preview, alt: "Your photo" } : draft === null ? null : draft.photo;
  const signedIn = `Signed in with PayPal as ${view.seller.name}`;
  const hood = <SellUnderTheHood draft={work.kind === "matching" ? null : draft} payerIdLast4={view.seller.payerIdLast4} />;

  let panel: ReactNode;
  if (draft !== null && draft.status === "listed" && draft.details !== null) {
    panel = (
      <SellPanel
        title={`Listed for ${formatUsdShort(draft.details.priceCents)}`}
        subtitle="Students moving in can find it now"
        step={2}
        hood
        footer={
          <>
            <Button className="w-full" onClick={newPhoto}>
              List another item
            </Button>
            <Link href="/furnish" className="inline-flex min-h-11 items-center justify-center rounded-lg text-sm font-medium key-hover:bg-well">
              Furnish a room as a buyer
            </Link>
          </>
        }
      >
        <h2 className="text-xl font-semibold text-balance">{draft.details.title}</h2>
        <p className="text-base">The buyer agent can place it in any room it furnishes from now on. When a student pays, PayPal holds the money until they check the item at handoff, then pays you.</p>
        <p className="text-sm text-flint">{payoutWords(view.seller.payerIdLast4)}</p>
        {hood}
      </SellPanel>
    );
  } else if (draft !== null && draft.status === "ready" && draft.details !== null && !working) {
    panel = <DetailsPanel key={draft.id} view={view} draft={draft} details={draft.details} subtitle={signedIn} listing={work.kind === "listing"} error={error} onList={(input) => void onList(input)} onNewPhoto={newPhoto} />;
  } else if (working || (draft !== null && draft.status === "matched")) {
    panel = (
      <SellPanel title="Reading your photo" subtitle={signedIn} step={0} hood={work.kind !== "matching"} footer={<Button className="w-full" loadingLabel="Filling in the details" />}>
        <SellProgress steps={progressSteps(work.kind === "matching" ? null : draft, work)} />
        {hood}
      </SellPanel>
    );
  } else if (draft !== null && draft.status === "failed") {
    panel = (
      <SellPanel
        title="Reading your photo"
        subtitle={signedIn}
        step={0}
        hood
        footer={
          <>
            <ErrorLine error={error} />
            <Button className="w-full" onClick={() => void describe(draft.id)}>
              Try again
            </Button>
            <Button variant="quiet" size="sm" onClick={newPhoto}>
              Use a different photo
            </Button>
          </>
        }
      >
        <PanelState kind="error" title="The details did not fill in" body={draft.error ?? "The seller agent stopped before it answered."} />
        {hood}
      </SellPanel>
    );
  } else {
    panel = (
      <SellPanel
        title="Sell an item"
        subtitle={signedIn}
        step={0}
        hood={false}
        footer={
          <>
            <ErrorLine error={error} />
            <Button className="w-full" onClick={pick}>
              Take a photo
            </Button>
          </>
        }
      >
        <p className="text-base">Take one photo of the item on its own. Claude reads what it is and its condition, and Channel3 finds it in retail catalogs for its size and new price.</p>
        {view.samples.length > 0 && (
          <section aria-labelledby="sell-samples-title" className="flex flex-col gap-3">
            <h2 id="sell-samples-title" className="text-sm font-medium">
              No item at hand? Use a sample photo
            </h2>
            <ul className="grid grid-cols-3 gap-3">
              {view.samples.map((sample) => (
                <li key={sample.slug}>
                  <button
                    type="button"
                    onClick={() => onSample(sample.slug, sample.src)}
                    className="flex w-full flex-col gap-2 rounded-lg p-1 text-left transition-colors duration-(--duration-quick) hover:bg-well key-focus:outline-2 key-focus:outline-offset-2 key-focus:outline-ink"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- small committed thumbnails, sized by the grid. */}
                    <img src={sample.src} alt="" className="aspect-square w-full rounded-md bg-well object-cover" />
                    <span className="text-xs">{sample.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="flex flex-col gap-1 text-sm text-flint">
          <p>{payoutWords(view.seller.payerIdLast4)}</p>
          <form action="/api/auth/paypal/logout" method="post">
            <button type="submit" className="inline-flex min-h-11 items-center rounded-md font-medium text-ink underline underline-offset-4">
              Not you? Sign out
            </button>
          </form>
        </div>
      </SellPanel>
    );
  }

  return (
    <main className={SHELL_COLUMNS}>
      {fileInput}
      <section aria-label="Your photo" className="min-w-0 lg:h-full lg:min-h-0">
        <PhotoPlate photo={photo} emptyText="Take a photo, or choose one from this device" onPick={working ? undefined : pick} />
      </section>
      <UnderTheHoodProvider>{panel}</UnderTheHoodProvider>
    </main>
  );
}
