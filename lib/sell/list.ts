import { campusDay, CAMPUS } from "@/scripts/seed/campus";
import { listDraft, loadDraft, loadListingPhoto } from "@/lib/db/sell";
import type { listings } from "@/lib/db/schema";
import { sellWindows, type DraftDetails, type ListInput } from "@/lib/domain/sell";
import type { RetailReference } from "@/lib/domain/listing";
import { clampPrices } from "@/lib/domain/pricing";
import { draftPhotoSrc, SellRefused, type SellDeps } from "./analyze";
import { sellSampleBySrc } from "./samples";

function retailReference(details: DraftDetails, today: string): RetailReference {
  const match = details.match;
  if (match === null) {
    return {
      productName: `New ${details.title.toLowerCase()}`,
      newPriceCents: details.newPriceCents,
      source: "seller_agent",
      sourceNote: "Estimated by the seller agent from the photo, because Channel3 found no product that matches it.",
      checkedOn: today,
    };
  }
  return {
    productName: match.title,
    newPriceCents: match.newPriceCents,
    source: "channel3",
    sourceNote: `Channel3 image match, the lowest new price at ${match.domain}.`,
    ...(match.url.startsWith("https://") ? { url: match.url } : {}),
    channel3ProductId: match.productId,
    checkedOn: today,
  };
}

/**
 * Lists a ready draft with the seller's last choices. The server clamps the
 * prices again, takes the size from Channel3 unless the seller entered one,
 * and builds the windows from the campus calendar, so the listing joins the
 * catalog the buyer agent searches on the same terms as a seeded one.
 */
export async function listFromDraft(deps: SellDeps, draftId: string, input: ListInput): Promise<string> {
  const draft = await loadDraft(deps.db, draftId, deps.seller.id);
  if (draft === null) throw new SellRefused(404, "That photo is not one of yours.");
  if (draft.status === "listed" && draft.listingId !== null) return draft.listingId;
  if (draft.status !== "ready" || draft.details === null) throw new SellRefused(409, "The details are not filled in yet.");
  const details = draft.details;

  const size = input.sizeMm ?? details.sizeMm;
  if (size === null) throw new SellRefused(422, "Enter the width, depth, and height, so the buyer agent can check it fits.");
  const windows = sellWindows(input.moveOut, input.handoffMode, deps.now());
  if (windows === null) throw new SellRefused(422, "Nobody moves in while you are still here after spring finals, so choose storage or same room.");
  if (input.handoffMode === "same_room" && deps.seller.room === null) throw new SellRefused(422, "Same room needs the room you live in, and Roomover has none for you. Choose direct or storage.");
  const prices = clampPrices(input, details.newPriceCents);

  const src = draftPhotoSrc(draft);
  const photoSize = draft.photoId === null ? sellSampleBySrc(src) : await loadListingPhoto(deps.db, draft.photoId);
  if (photoSize === undefined || photoSize === null) throw new SellRefused(409, "The photo for this item is gone. Take it again.");
  const room = input.handoffMode === "same_room" ? deps.seller.room : null;

  const listing: typeof listings.$inferInsert = {
    sellerId: deps.seller.id,
    campus: CAMPUS,
    category: details.category,
    placement: details.placement,
    title: details.title,
    description: details.description,
    color: details.color.name,
    colors: [details.color],
    material: details.material,
    styleTags: details.styleTags,
    widthMm: size.widthMm,
    depthMm: size.depthMm,
    heightMm: size.heightMm,
    specs: {},
    photos: [{ src, alt: details.title, widthPx: photoSize.widthPx, heightPx: photoSize.heightPx }],
    conditionReport: { grade: details.conditionGrade, notes: details.description, defects: details.defects, assessedBy: "seller_agent" },
    retailReference: retailReference(details, campusDay(deps.now())),
    priceCents: prices.priceCents,
    floorPriceCents: prices.floorPriceCents,
    ...windows,
    handoffMode: input.handoffMode,
    roomPresetId: room?.presetId ?? null,
    roomNumber: room?.number ?? null,
    status: "active",
    sessionId: deps.sessionId,
  };
  const listingId = await listDraft(deps.db, draftId, deps.seller.id, listing);
  if (listingId === null) throw new SellRefused(409, "The details are not filled in yet.");
  return listingId;
}
