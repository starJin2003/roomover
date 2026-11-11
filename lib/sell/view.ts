import type { SellerProfile } from "@/lib/db/sellers";
import type { DraftRow } from "@/lib/db/sell";
import type { HandoffMode, ListingDraftStatus } from "@/lib/domain/enums";
import { priceBounds } from "@/lib/domain/pricing";
import { IMAGE_SEARCH } from "@/lib/channel3/transport";
import { retailerName } from "@/lib/domain/savings";
import { MOVE_OUT_TERMS, sellWindows, type Channel3Candidate, type DraftDetails, type MoveOutTerm, type SizeMmFields } from "@/lib/domain/sell";
import { CONDITION_LABEL, formatDayRange } from "@/lib/format";
import { firstNameOf } from "@/lib/handoff/words";
import { draftPhotoSrc } from "./analyze";
import { SELL_SAMPLES } from "./samples";

export interface MoveOutOption {
  term: MoveOutTerm;
  label: string;
  /** The move out dates per handoff mode, or null where the mode cannot serve the term. */
  modes: Record<HandoffMode, string | null>;
}

export interface SellProductView {
  productId: string;
  title: string;
  retailer: string;
  newPriceCents: number;
}

export interface SellDraftView {
  id: string;
  status: ListingDraftStatus;
  photo: { src: string; alt: string };
  channel3: {
    /** The image search request in words, for the Developer view. */
    query: string;
    candidateCount: number;
    /** Every product kept from the search, marked when the seller agent picked it as similar. */
    candidates: (SellProductView & { picked: boolean })[];
    credits: number;
    cached: boolean;
    latencyMs: number;
    unavailable: string | null;
  };
  /** The candidate the seller agent said is the same product. */
  match: { productId: string; title: string; brand: string | null; domain: string; newPriceCents: number } | null;
  /** With no match, the products the seller agent called similar, closest first, and the median code priced from. */
  similar: { products: SellProductView[]; referenceCents: number; sizeMm: [number, number, number] | null } | null;
  details: {
    title: string;
    description: string;
    condition: string;
    defects: string[];
    colorName: string;
    newPriceCents: number;
    newPriceSource: DraftDetails["newPriceSource"];
    priceCents: number;
    floorPriceCents: number;
    minPriceCents: number;
    maxPriceCents: number;
    sizeMm: [number, number, number] | null;
  } | null;
  error: string | null;
  /** The seller agent's run. Mode is null before it starts, and fixture when a test replayed a recording. */
  claude: { mode: "live" | "fixture" | null; model: string | null; calls: number; inputTokens: number; outputTokens: number; describeMs: number | null };
  listingId: string | null;
}

export interface SellView {
  seller: { name: string; firstName: string; payerIdLast4: string | null; roomLabel: string | null };
  draft: SellDraftView | null;
  samples: { slug: string; src: string; label: string }[];
  moveOut: MoveOutOption[];
}

const TERM_LABEL: Readonly<Record<MoveOutTerm, string>> = { this_term: "End of this term", spring: "After spring finals" };

export function moveOutOptions(now: Date): MoveOutOption[] {
  return MOVE_OUT_TERMS.map((term) => {
    const dates = (mode: HandoffMode) => {
      const windows = sellWindows(term, mode, now);
      return windows === null ? null : formatDayRange(windows.moveOutStartsAt, windows.moveOutEndsAt);
    };
    return { term, label: TERM_LABEL[term], modes: { direct: dates("direct"), storage_hold: dates("storage_hold"), same_room: dates("same_room") } };
  });
}

const productView = (candidate: Channel3Candidate): SellProductView => ({ productId: candidate.productId, title: candidate.title, retailer: retailerName(candidate.domain), newPriceCents: candidate.newPriceCents });
const sizeTuple = (size: SizeMmFields | null): [number, number, number] | null => (size === null ? null : [size.widthMm, size.depthMm, size.heightMm]);
const CHANNEL3_QUERY = `Your photo as base64, limit ${IMAGE_SEARCH.limit}, ${IMAGE_SEARCH.config.country}, ${IMAGE_SEARCH.config.currency}, lengths in ${IMAGE_SEARCH.config.length_unit}`;

export function draftView(draft: DraftRow): SellDraftView {
  const details = draft.details;
  const match = details?.match ?? null;
  const similar = details?.similar ?? null;
  const picked = new Set(similar?.products.map((product) => product.productId) ?? []);
  const bounds = details === null ? null : priceBounds(details.newPriceCents);
  return {
    id: draft.id,
    status: draft.status,
    photo: { src: draftPhotoSrc(draft), alt: details?.title ?? "Your photo" },
    channel3: {
      query: CHANNEL3_QUERY,
      candidateCount: draft.channel3.candidates.length,
      candidates: draft.channel3.candidates.map((candidate) => ({ ...productView(candidate), picked: picked.has(candidate.productId) })),
      credits: draft.channel3.credits,
      cached: draft.channel3.cached,
      latencyMs: draft.channel3.latencyMs,
      unavailable: draft.channel3.unavailable,
    },
    match: match === null ? null : { productId: match.productId, title: match.title, brand: match.brand, domain: match.domain, newPriceCents: match.newPriceCents },
    similar: similar === null ? null : { products: similar.products.map(productView), referenceCents: similar.referenceCents, sizeMm: sizeTuple(similar.sizeMm) },
    details:
      details === null || bounds === null
        ? null
        : {
            title: details.title,
            description: details.description,
            condition: CONDITION_LABEL[details.conditionGrade],
            defects: details.defects.map((defect) => `${defect.location}: ${defect.description}`),
            colorName: details.color.name.charAt(0).toUpperCase() + details.color.name.slice(1),
            newPriceCents: details.newPriceCents,
            newPriceSource: details.newPriceSource,
            priceCents: details.priceCents,
            floorPriceCents: details.floorPriceCents,
            minPriceCents: bounds.minPriceCents,
            maxPriceCents: bounds.maxPriceCents,
            sizeMm: sizeTuple(details.sizeMm),
          },
    error: draft.error,
    claude: { mode: draft.claudeMode, model: details?.model ?? null, calls: draft.claudeCalls, inputTokens: draft.inputTokens, outputTokens: draft.outputTokens, describeMs: draft.describeMs },
    listingId: draft.listingId,
  };
}

export function sellView(seller: SellerProfile, draft: DraftRow | null, now: Date): SellView {
  return {
    seller: {
      name: seller.displayName,
      firstName: firstNameOf(seller.displayName),
      payerIdLast4: seller.paypalAccountId === null ? null : seller.paypalAccountId.slice(-4),
      roomLabel: seller.room?.label ?? null,
    },
    draft: draft === null ? null : draftView(draft),
    samples: SELL_SAMPLES.map((sample) => ({ slug: sample.slug, src: sample.src, label: sample.label })),
    moveOut: moveOutOptions(now),
  };
}
