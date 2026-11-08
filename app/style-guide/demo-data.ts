import type { ActivityEntry } from "@/components/activity/activity-line";
import type { LedgerRow } from "@/components/ledger/settlement-ledger";
import type { ListingCardData } from "@/components/ui/listing-card";
import { sumCents } from "@/lib/domain/money";
import { formatUsd } from "@/lib/format";
import { seedId } from "@/scripts/seed/ids";
import { seedListings } from "@/scripts/seed/listings";
import { SELLER_SLUGS, seedUsers, userId, type SellerSlug } from "@/scripts/seed/people";

// Listing windows move with the seed day. The style guide shows none, so any day works.
const SEED_DAY = "2026-11-08";

const listingsById = new Map(seedListings(SEED_DAY).map((listing) => [listing.id, listing]));
const namesById = new Map(seedUsers().map((user) => [user.id, user.displayName]));

function seedListing(slug: string) {
  const listing = listingsById.get(seedId("listing", slug));
  if (listing === undefined) throw new Error(`No seed listing ${slug}.`);
  return listing;
}

const sellerName = (slug: SellerSlug) => namesById.get(userId(slug)) ?? slug;

export function listingCard(slug: string): ListingCardData {
  const listing = seedListing(slug);
  const [photo] = listing.photos;
  return {
    title: listing.title,
    photo: { src: photo.src, alt: photo.alt, widthPx: photo.widthPx, heightPx: photo.heightPx },
    grade: listing.conditionReport.grade,
    sizeMm: [listing.widthMm, listing.depthMm, listing.heightMm],
    priceCents: listing.priceCents,
    newPriceCents: listing.retailReference.newPriceCents,
    sellerName: namesById.get(listing.sellerId) ?? "Unknown seller",
    handoffMode: listing.handoffMode ?? "direct",
  };
}

export const CARD_SLUGS = ["ava-desk-lamp", "lea-navy-bean-bag", "marcus-oak-writing-table"] as const;

/**
 * Jordan Ellis's winter cart for Harbor Hall 214, one item from each seller.
 * Jun's desk was negotiated down from its list price, and the verifier cut
 * Marcus's chair after a new tear showed up at handoff.
 */
const desk = seedListing("jun-white-desk");
const chair = seedListing("marcus-mesh-desk-chair");
const halogenLamp = seedListing("marcus-green-floor-lamp");
const AGREED_DESK_CENTS = 5_200;
const OFFER_DESK_CENTS = 4_800;
const ADJUSTED_CHAIR_CENTS = 3_000;

const CART: readonly { seller: SellerSlug; authorizedCents: number; capturedCents: number }[] = [
  { seller: "ava", authorizedCents: seedListing("ava-desk-lamp").priceCents, capturedCents: seedListing("ava-desk-lamp").priceCents },
  { seller: "marcus", authorizedCents: chair.priceCents, capturedCents: ADJUSTED_CHAIR_CENTS },
  { seller: "sofia", authorizedCents: seedListing("sofia-clamp-lamp").priceCents, capturedCents: seedListing("sofia-clamp-lamp").priceCents },
  { seller: "jun", authorizedCents: AGREED_DESK_CENTS, capturedCents: AGREED_DESK_CENTS },
  { seller: "lea", authorizedCents: seedListing("lea-navy-bean-bag").priceCents, capturedCents: seedListing("lea-navy-bean-bag").priceCents },
];

const authorizedCents = sumCents(CART.map((item) => item.authorizedCents));
const capturedCents = sumCents(CART.map((item) => item.capturedCents));
const releasedChairCents = chair.priceCents - ADJUSTED_CHAIR_CENTS;

const at = (iso: string, label: string) => ({ iso, label });

export const ACTIVITY: readonly ActivityEntry[] = [
  {
    agent: "buyer",
    actor: "Buyer agent",
    tool: "get_hall_rules",
    at: at("2026-11-08T14:14:07-06:00", "Nov 8, 2:14 PM"),
    summary:
      "Read the Harbor Hall room standards. Refrigerators up to 113 liters, no halogen bulbs, and a 915 mm path from each bed to the door.",
  },
  {
    agent: "buyer",
    actor: "Buyer agent",
    tool: "search_listings",
    at: at("2026-11-08T14:14:31-06:00", "Nov 8, 2:14 PM"),
    blocked: true,
    summary: `${halogenLamp.title} from ${sellerName("marcus")}. Harbor Hall rule 1.1 prohibits halogen lamps and bulbs.`,
  },
  {
    agent: "buyer",
    actor: "Buyer agent",
    tool: "check_fit",
    at: at("2026-11-08T14:15:02-06:00", "Nov 8, 2:15 PM"),
    summary: `${desk.title} fits under the north window. The path to the door stays 1,180 mm wide, and rule 2.2 asks for 915 mm.`,
  },
  {
    agent: "buyer",
    actor: "Buyer agent",
    tool: "make_offer",
    at: at("2026-11-08T14:15:40-06:00", "Nov 8, 2:15 PM"),
    summary: `Offered on ${desk.title}, listed at ${formatUsd(desk.priceCents)}.`,
    terms: [
      { label: "Price", value: formatUsd(OFFER_DESK_CENTS) },
      { label: "Handoff", value: "Nov 23, 2 to 4 PM" },
    ],
  },
  {
    agent: "seller",
    actor: `${sellerName("jun").split(" ")[0]}'s seller agent`,
    tool: "respond_to_offer",
    at: at("2026-11-08T14:15:52-06:00", "Nov 8, 2:15 PM"),
    summary: "Countered and kept the handoff slot. The buyer agent accepted, and the floor price stayed private.",
    terms: [
      { label: "Price", value: formatUsd(AGREED_DESK_CENTS) },
      { label: "Outcome", value: "Agreed" },
    ],
  },
  {
    agent: "platform",
    actor: "Platform",
    tool: "create_checkout",
    at: at("2026-11-08T14:21:18-06:00", "Nov 8, 2:21 PM"),
    summary: `One order for ${CART.length} items from ${CART.length} sellers, ${formatUsd(authorizedCents)}, intent AUTHORIZE.`,
    paypal: { api: "PayPal Orders v2", idLabel: "Order", id: "8RU61172JS455403V" },
  },
  {
    agent: "platform",
    actor: "Platform",
    tool: "authorize_order",
    at: at("2026-11-08T14:23:05-06:00", "Nov 8, 2:23 PM"),
    summary: `Jordan approved once. PayPal holds ${formatUsd(authorizedCents)} for up to 29 days.`,
    paypal: { api: "PayPal Payments v2", idLabel: "Authorization", id: "0TF88542GM8203619" },
  },
  {
    agent: "verifier",
    actor: "Verifier",
    tool: "compare_photos",
    at: at("2026-11-23T14:31:44-06:00", "Nov 23, 2:31 PM"),
    summary: `The handoff photo of the ${chair.title.toLowerCase()} shows a 3 cm tear in the mesh that the listing photos do not. Recommends ${formatUsd(ADJUSTED_CHAIR_CENTS)} of ${formatUsd(chair.priceCents)}.`,
  },
  {
    agent: "platform",
    actor: "Platform",
    tool: "capture_items",
    at: at("2026-11-23T14:33:10-06:00", "Nov 23, 2:33 PM"),
    summary: `Captured the chair at ${formatUsd(ADJUSTED_CHAIR_CENTS)} with final capture. The other ${formatUsd(releasedChairCents)} goes back to Jordan.`,
    paypal: { api: "PayPal Payments v2", idLabel: "Capture", id: "2GG279541U471931P" },
  },
  {
    agent: "platform",
    actor: "Platform",
    tool: "send_payouts",
    at: at("2026-11-23T14:35:27-06:00", "Nov 23, 2:35 PM"),
    summary: `Paid ${CART.length} sellers ${formatUsd(capturedCents)} in one batch.`,
    paypal: { api: "PayPal Payouts", idLabel: "Payout batch", id: "7XJ4TQ2HW9N3E" },
  },
];

// seller1 through seller5 in the sandbox follow the seller order in the seed.
const sandboxAccount = (seller: SellerSlug) => `Sandbox seller${SELLER_SLUGS.indexOf(seller) + 1}`;

export const LEDGER: readonly LedgerRow[] = [
  {
    account: "Roomover platform",
    detail: "Held for sellers",
    beforeCents: capturedCents,
    afterCents: 0,
  },
  ...CART.map((item) => ({
    account: sellerName(item.seller),
    detail: sandboxAccount(item.seller),
    beforeCents: 0,
    afterCents: item.capturedCents,
  })),
];

export const LEDGER_SUMMARY = {
  capturedCents,
  authorizedCents,
  releasedCents: releasedChairCents,
  batchId: "7XJ4TQ2HW9N3E",
};
