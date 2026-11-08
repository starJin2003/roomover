import type { users } from "@/lib/db/schema";
import { CAMPUS, PRESET_SLUGS } from "./campus";
import { seedId } from "./ids";

export type SeedUser = typeof users.$inferInsert & { id: string };

/** Sandbox accounts in the Roomover PayPal developer app. Payouts go to these emails. */
export const SANDBOX_EMAILS = {
  platform: "sb-hbhwh53788009@business.example.com",
  judgeBuyer: "roomover-judge-jin0608@personal.example.com",
  sellers: [
    "roomover-seller1-jin0608@personal.example.com",
    "roomover-seller2-jin0608@personal.example.com",
    "roomover-seller3-jin0608@personal.example.com",
    "roomover-seller4-jin0608@personal.example.com",
    "roomover-seller5-jin0608@personal.example.com",
  ],
} as const;

export const SELLER_SLUGS = ["ava", "marcus", "sofia", "jun", "lea"] as const;
export type SellerSlug = (typeof SELLER_SLUGS)[number];

export const userId = (slug: string) => seedId("user", slug);
export const presetId = (slug: string) => seedId("room-preset", slug);

export function seedUsers(): SeedUser[] {
  const [seller1, seller2, seller3, seller4, seller5] = SANDBOX_EMAILS.sellers;
  return [
    {
      id: userId("platform"),
      role: "platform",
      displayName: "Roomover",
      campus: null,
      classYear: null,
      leavingReason: null,
      bio: "Platform account. Collects checkout payments and funds seller payouts.",
      paypalEmail: SANDBOX_EMAILS.platform,
      payoutWallet: "paypal",
      venmoHandle: null,
      roomPresetId: null,
      roomNumber: null,
    },
    {
      id: userId("jordan"),
      role: "buyer",
      displayName: "Jordan Ellis",
      campus: CAMPUS,
      classYear: 2029,
      leavingReason: null,
      bio: "Transfer student arriving for winter quarter, assigned to Harbor Hall 214.",
      paypalEmail: SANDBOX_EMAILS.judgeBuyer,
      payoutWallet: "paypal",
      venmoHandle: null,
      roomPresetId: presetId(PRESET_SLUGS.harborDouble),
      roomNumber: "214",
    },
    {
      id: userId("ava"),
      role: "seller",
      displayName: "Ava Lindqvist",
      campus: CAMPUS,
      classYear: 2027,
      leavingReason: "graduating",
      bio: "Senior graduating at the end of spring quarter. Moves from a Harbor Hall double to a Birchwood House single for winter quarter, so the extras go at winter move in and the rest after commencement.",
      paypalEmail: seller1,
      payoutWallet: "paypal",
      venmoHandle: null,
      roomPresetId: presetId(PRESET_SLUGS.harborDouble),
      roomNumber: "126",
    },
    {
      id: userId("marcus"),
      role: "seller",
      displayName: "Marcus Bell",
      campus: CAMPUS,
      classYear: 2027,
      leavingReason: "lease_end",
      bio: "Breakwater Apartments lease ends two weeks after spring quarter. Stays in town through winter, so spare pieces go now and the apartment furniture goes to storage after the lease ends.",
      paypalEmail: seller2,
      payoutWallet: "paypal",
      venmoHandle: null,
      roomPresetId: presetId(PRESET_SLUGS.breakwaterBedroom),
      roomNumber: "4B",
    },
    {
      id: userId("sofia"),
      role: "seller",
      displayName: "Sofia Navarro",
      campus: CAMPUS,
      classYear: 2029,
      leavingReason: "transfer",
      bio: "Transfers to a university closer to home after fall quarter and leaves a set up half of Harbor Hall 214 for the next resident.",
      paypalEmail: seller3,
      payoutWallet: "paypal",
      venmoHandle: null,
      roomPresetId: presetId(PRESET_SLUGS.harborDouble),
      roomNumber: "214",
    },
    {
      id: userId("jun"),
      role: "seller",
      displayName: "Jun Park",
      campus: CAMPUS,
      classYear: 2028,
      leavingReason: "leave_of_absence",
      bio: "Takes a leave of absence from winter quarter for a full time research internship. Stays with family nearby and meets buyers on campus until winter move in ends.",
      paypalEmail: seller4,
      payoutWallet: "paypal",
      venmoHandle: null,
      roomPresetId: presetId(PRESET_SLUGS.birchwoodSingle),
      roomNumber: "302",
    },
    {
      id: userId("lea"),
      role: "seller",
      displayName: "Lea Moreau",
      campus: CAMPUS,
      classYear: null,
      leavingReason: "exchange",
      bio: "Exchange student from Lyon for fall quarter. Flies home the day after the halls close and leaves the room essentials in Harbor Hall 214 for the next resident.",
      paypalEmail: seller5,
      payoutWallet: "paypal",
      venmoHandle: null,
      roomPresetId: presetId(PRESET_SLUGS.harborDouble),
      roomNumber: "214",
    },
  ];
}
