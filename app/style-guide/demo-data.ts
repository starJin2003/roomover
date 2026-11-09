import type { ActivityEntry } from "@/components/activity/activity-log";
import type { HandoffChecklistItem } from "@/components/handoff/item-checklist";
import type { PayPalMoment, PayPalReference } from "@/components/paypal/paypal-card";
import type { SellerPayout } from "@/components/payouts/sellers-paid";
import { sumCents } from "@/lib/domain/money";
import { CONDITION_LABEL, formatDayRange, formatInches, formatUsdShort } from "@/lib/format";
import { seedId } from "@/scripts/seed/ids";
import { seedListings } from "@/scripts/seed/listings";
import { seedUsers, userId, type SellerSlug } from "@/scripts/seed/people";

// Seed windows move with the seed day. This day puts Ava's move out on Nov 17 to 25.
const SEED_DAY = "2026-11-08";

const listingsById = new Map(seedListings(SEED_DAY).map((listing) => [listing.id, listing]));
const namesById = new Map(seedUsers().map((user) => [user.id, user.displayName]));

function seedListing(slug: string) {
  const listing = listingsById.get(seedId("listing", slug));
  if (listing === undefined) throw new Error(`No seed listing ${slug}.`);
  return listing;
}

const sellerName = (slug: SellerSlug) => namesById.get(userId(slug)) ?? slug;
const firstName = (slug: SellerSlug) => sellerName(slug).split(" ")[0];
const usd = formatUsdShort;

/**
 * Jordan Ellis's winter cart for Harbor Hall 214, one item from each seller,
 * largest payout first. Jun's desk was negotiated down from its list price,
 * and the verifier cut Marcus's chair after a new tear showed up at handoff.
 */
const AGREED_DESK_CENTS = 5_200;
const OFFER_DESK_CENTS = 4_800;
const ADJUSTED_CHAIR_CENTS = 3_000;
export const BUDGET_CENTS = 15_000;

const CART = [
  { seller: "jun", slug: "jun-white-desk", authorizedCents: AGREED_DESK_CENTS, capturedCents: AGREED_DESK_CENTS },
  { seller: "marcus", slug: "marcus-mesh-desk-chair", authorizedCents: seedListing("marcus-mesh-desk-chair").priceCents, capturedCents: ADJUSTED_CHAIR_CENTS },
  { seller: "lea", slug: "lea-navy-bean-bag", authorizedCents: seedListing("lea-navy-bean-bag").priceCents, capturedCents: seedListing("lea-navy-bean-bag").priceCents },
  { seller: "ava", slug: "ava-desk-lamp", authorizedCents: seedListing("ava-desk-lamp").priceCents, capturedCents: seedListing("ava-desk-lamp").priceCents },
  { seller: "sofia", slug: "sofia-clamp-lamp", authorizedCents: seedListing("sofia-clamp-lamp").priceCents, capturedCents: seedListing("sofia-clamp-lamp").priceCents },
] as const satisfies readonly { seller: SellerSlug; slug: string; authorizedCents: number; capturedCents: number }[];

/** What Jordan pays for each cart item, by listing ID. Jun's desk carries the negotiated price. */
export const CART_PRICE_CENTS: ReadonlyMap<string, number> = new Map(CART.map((item) => [seedId("listing", item.slug), item.authorizedCents]));

const desk = seedListing("jun-white-desk");
const chair = seedListing("marcus-mesh-desk-chair");

export const MONEY = {
  authorizedCents: sumCents(CART.map((item) => item.authorizedCents)),
  capturedCents: sumCents(CART.map((item) => item.capturedCents)),
  releasedCents: chair.priceCents - ADJUSTED_CHAIR_CENTS,
  newCents: sumCents(CART.map((item) => seedListing(item.slug).retailReference.newPriceCents)),
};

export const FURNISH = {
  room: "Harbor Hall 214",
  subtitle: `Jordan's room, ${usd(BUDGET_CENTS)} budget`,
  sentences: [
    `Found a desk that fits under the window. ${usd(AGREED_DESK_CENTS)} from ${firstName("jun")}.`,
    `Skipped a floor lamp from ${firstName("marcus")}. Harbor Hall does not allow halogen bulbs.`,
    `Your room is ready. ${CART.length} items from ${CART.length} students.`,
  ],
};

const at = (iso: string, label: string) => ({ iso, label });

export const ACTIVITY_LOG: readonly ActivityEntry[] = [
  {
    agent: "buyer",
    actor: "Buyer agent",
    tool: "get_hall_rules",
    at: at("2026-11-08T14:14:07-06:00", "Nov 8, 2:14 PM"),
    summary: "Read the Harbor Hall room standards. Refrigerators up to 113 liters, no halogen bulbs, and a 915 mm path from each bed to the door.",
  },
  {
    agent: "buyer",
    actor: "Buyer agent",
    tool: "search_listings",
    at: at("2026-11-08T14:14:31-06:00", "Nov 8, 2:14 PM"),
    blocked: true,
    summary: `${seedListing("marcus-green-floor-lamp").title} from ${sellerName("marcus")}. Harbor Hall rule 1.1 prohibits halogen lamps and bulbs.`,
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
    summary: `Offered ${usd(OFFER_DESK_CENTS)} for the desk listed at ${usd(desk.priceCents)}, with a handoff on Nov 23 from 2 to 4 PM.`,
  },
  {
    agent: "seller",
    actor: `${firstName("jun")}'s seller agent`,
    tool: "respond_to_offer",
    at: at("2026-11-08T14:15:52-06:00", "Nov 8, 2:15 PM"),
    summary: `Countered at ${usd(AGREED_DESK_CENTS)} and kept the handoff slot. The buyer agent accepted, and the floor price stayed private.`,
  },
  {
    agent: "platform",
    actor: "Platform",
    tool: "create_checkout",
    at: at("2026-11-08T14:21:18-06:00", "Nov 8, 2:21 PM"),
    summary: `One order for ${CART.length} items from ${CART.length} sellers, ${usd(MONEY.authorizedCents)}, intent AUTHORIZE.`,
    paypal: { api: "PayPal Orders v2", idLabel: "Order", id: "8RU61172JS455403V" },
  },
  {
    agent: "platform",
    actor: "Platform",
    tool: "authorize_order",
    at: at("2026-11-08T14:23:05-06:00", "Nov 8, 2:23 PM"),
    summary: `Jordan approved once. PayPal holds ${usd(MONEY.authorizedCents)} for up to 29 days.`,
    paypal: { api: "PayPal Payments v2", idLabel: "Authorization", id: "0TF88542GM8203619" },
  },
  {
    agent: "verifier",
    actor: "Verifier",
    tool: "compare_photos",
    at: at("2026-11-23T14:31:44-06:00", "Nov 23, 2:31 PM"),
    summary: `The handoff photo of the ${chair.title.toLowerCase()} shows a 3 cm tear in the mesh that the listing photos do not. Recommends ${usd(ADJUSTED_CHAIR_CENTS)} of ${usd(chair.priceCents)}.`,
  },
  {
    agent: "platform",
    actor: "Platform",
    tool: "capture_items",
    at: at("2026-11-23T14:33:10-06:00", "Nov 23, 2:33 PM"),
    summary: `Captured ${usd(MONEY.capturedCents)} with final capture. The other ${usd(MONEY.releasedCents)} went back to Jordan.`,
    paypal: { api: "PayPal Payments v2", idLabel: "Capture", id: "2GG279541U471931P" },
  },
  {
    agent: "platform",
    actor: "Platform",
    tool: "send_payouts",
    at: at("2026-11-23T14:35:27-06:00", "Nov 23, 2:35 PM"),
    summary: `Paid ${CART.length} sellers ${usd(MONEY.capturedCents)} in one batch.`,
    paypal: { api: "PayPal Payouts", idLabel: "Payout batch", id: "7XJ4TQ2HW9N3E" },
  },
];

const reference = (tool: string): PayPalReference => {
  const paypal = ACTIVITY_LOG.find((entry) => entry.tool === tool)?.paypal;
  if (paypal === undefined) throw new Error(`No PayPal step for ${tool}.`);
  return { api: paypal.api, label: paypal.idLabel, id: paypal.id };
};

export const PAYPAL_MOMENTS = {
  heldAfterApproval: {
    moment: "held",
    title: `PayPal is holding ${usd(MONEY.authorizedCents)}`,
    detail: "Until you check each item at handoff",
    references: [reference("create_checkout"), reference("authorize_order")],
  },
  heldAtHandoff: {
    moment: "held",
    title: `PayPal is holding ${usd(MONEY.authorizedCents)}`,
    detail: "Until you finish checking every item",
    references: [reference("authorize_order")],
  },
  captured: {
    moment: "captured",
    title: `PayPal captured ${usd(MONEY.capturedCents)}`,
    detail: `${usd(MONEY.releasedCents)} went back to Jordan for the chair's new tear`,
    references: [reference("capture_items")],
  },
  paid: {
    moment: "paid",
    title: `PayPal paid ${CART.length} sellers ${usd(MONEY.capturedCents)}`,
    detail: "One payout sent each seller their share",
    references: [reference("send_payouts")],
  },
} as const satisfies Record<string, { moment: PayPalMoment; title: string; detail: string; references: readonly PayPalReference[] }>;

export const HANDOFF = {
  subtitle: "Mon, Nov 23, 2 to 4 PM in Harbor Hall 214",
  items: CART.map((item): HandoffChecklistItem => {
    const listing = seedListing(item.slug);
    const check = { jun: "matches", marcus: "adjusted", lea: "next", ava: "matches", sofia: "waiting" } as const;
    return {
      id: listing.id,
      title: listing.title,
      sellerFirstName: firstName(item.seller),
      photo: { src: listing.photos[0].src },
      check: check[item.seller],
      note: item.seller === "marcus" ? `new 3 cm tear. You pay ${usd(ADJUSTED_CHAIR_CENTS)} of ${usd(chair.priceCents)}` : undefined,
    };
  }),
};

// Placeholder payout item IDs until settlement runs in the sandbox.
const PAYOUT_ITEM_IDS: Record<(typeof CART)[number]["seller"], string> = {
  jun: "5KQ8W2HD7N3PA",
  marcus: "9ZT4L6XB2RM8C",
  lea: "3HV7Q9JF5W2KD",
  ava: "6MC2P8RT4X9LE",
  sofia: "2WB5N7KQ3H8VF",
};

export const SELLER_PAYOUTS: readonly SellerPayout[] = CART.map((item) => ({
  payoutItemId: PAYOUT_ITEM_IDS[item.seller],
  sellerName: sellerName(item.seller),
  itemTitle: seedListing(item.slug).title,
  amountCents: item.capturedCents,
}));

/** Payout events rarely arrive in display order, so the replay fills rows out of order. */
export const PAYOUT_ARRIVALS: readonly string[] = (["lea", "jun", "sofia", "ava", "marcus"] as const).map((seller) => PAYOUT_ITEM_IDS[seller]);

const lamp = seedListing("ava-desk-lamp");

export const SELL = {
  title: lamp.title,
  priceCents: lamp.priceCents,
  floorCents: lamp.floorPriceCents,
  newCents: lamp.retailReference.newPriceCents,
  facts: [
    { label: "Lowest you'll take", value: usd(lamp.floorPriceCents) },
    { label: "Condition", value: CONDITION_LABEL[lamp.conditionReport.grade] },
    { label: "Size", value: formatInches([lamp.widthMm, lamp.depthMm, lamp.heightMm]) },
    { label: "Moving out", value: formatDayRange(lamp.moveOutStartsAt, lamp.moveOutEndsAt) },
  ],
};
