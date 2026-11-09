import type { FurnitureType } from "@/lib/domain/furniture";
import { majorDamageCents, minorDamageCents } from "@/lib/domain/money-policy";
import type { HandoffDecision } from "@/lib/domain/enums";
import { damageWords, type Damage, type Verdict } from "@/lib/domain/verdict";
import { formatUsdShort } from "@/lib/format";

/**
 * The sentences the Handoff screen tells its story in. Code writes every
 * one from structured facts, so the panel never shows the model's prose.
 */

const SHORT_NOUN: Readonly<Record<FurnitureType, string>> = {
  comforter: "comforter",
  pillows: "pillows",
  throw: "throw",
  desk: "desk",
  desk_chair: "chair",
  side_chair: "chair",
  armchair: "armchair",
  bean_bag: "bean bag",
  pouf: "poufs",
  bookcase: "bookcases",
  desk_lamp: "lamp",
  table_lamp: "lamp",
  clamp_lamp: "clamp lamp",
  floor_lamp: "floor lamp",
  rug: "rug",
  round_rug: "rug",
  mini_fridge: "fridge",
  drawer_unit: "drawers",
  basket: "baskets",
  tote: "tote",
};

/** "chair" for a mesh back rolling desk chair, the word a student would say. */
export const shortNoun = (type: FurnitureType): string => SHORT_NOUN[type];

export const firstNameOf = (name: string) => name.split(" ")[0];

const possessive = (name: string) => `${name}'s`;

export interface ItemWords {
  sellerFirstName: string;
  noun: string;
  priceCents: number;
}

/** What the verifier found, and what the student pays for it. */
export function findingSentence(item: ItemWords, verdict: Verdict, damage: Damage | null): string {
  const whose = `${possessive(item.sellerFirstName)} ${item.noun}`;
  const price = formatUsdShort(item.priceCents);
  switch (verdict) {
    case "match":
      return `${capitalize(whose)} matches the listing.`;
    case "new_damage": {
      const found = `${capitalize(whose)} has a new ${damage === null ? "mark" : damageWords(damage)}.`;
      if (damage?.severity === "major") return `${found} Keep it for ${formatUsdShort(majorDamageCents(item.priceCents))} or turn it down.`;
      return `${found} You pay ${formatUsdShort(minorDamageCents(item.priceCents))} of ${price}.`;
    }
    case "wrong_item":
      return `This is not the ${item.noun} ${item.sellerFirstName} listed. Turn it down and you pay nothing for it.`;
    case "missing":
      return `The photo does not show ${whose}. Take another, or tell Roomover it was not there.`;
  }
}

/** The short status under each checklist row, after the seller's first name. */
export function rowNote(verdict: Verdict | null, damage: Damage | null, decision: HandoffDecision | null, payCents: number | null): string {
  if (decision === "rejected") return "turned down, you pay nothing";
  if (decision === "missing") return "not there, you pay nothing";
  if (verdict === "new_damage" && payCents !== null) return `new ${damage?.kind ?? "damage"}, you pay ${formatUsdShort(payCents)}`;
  if (verdict === "new_damage") return `new ${damage?.kind ?? "damage"} found`;
  if (verdict === "wrong_item") return "not the listed item";
  if (verdict === "missing") return "not in the photo";
  return "matches the listing";
}

/** The line a confirmed decision writes to the activity panel. */
export function decisionSentence(item: ItemWords, decision: HandoffDecision, payCents: number): string {
  const whose = `${possessive(item.sellerFirstName)} ${item.noun}`;
  switch (decision) {
    case "accepted":
      return `You checked ${whose}. It is yours for ${formatUsdShort(payCents)}.`;
    case "adjusted":
      return `You kept ${whose} for ${formatUsdShort(payCents)} of ${formatUsdShort(item.priceCents)}.`;
    case "rejected":
      return `You turned down ${whose}, so you pay nothing for it.`;
    case "missing":
      return `${capitalize(whose)} was not there, so you pay nothing for it.`;
  }
}

/** What came back to the student for one item, once PayPal settled it. */
export function moneyBackSentence(item: ItemWords, releasedCents: number, damage: Damage | null, kept: boolean): string {
  const amount = formatUsdShort(releasedCents);
  if (kept && damage !== null) return `You got ${amount} back for the ${item.noun}'s new ${damage.kind}.`;
  return `You got ${amount} back for ${possessive(item.sellerFirstName)} ${item.noun}.`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
