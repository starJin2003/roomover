import type { ListingCategory, Placement } from "./enums";
import { LEVEL_TOLERANCE_MM, type FitRoom } from "./fit";
import { FURNITURE, furnitureTypeFor, nounFor } from "./furniture";
import { contains, rectangle, type Polygon } from "./geometry";
import { footprint, topMm, type LayoutItem, type PlanLayout } from "./layout";
import type { ListingSpecs } from "./listing";

/**
 * Turns a listing and a spot on the floor plan into a layout item, works out
 * what the item stands on, and moves items with whatever stands on them. The
 * buyer agent and the student's own edits share these rules, so the agent
 * never chooses an elevation and a lamp travels with its desk.
 */

export interface PlaceableListing {
  id: string;
  title: string;
  category: ListingCategory;
  placement: Placement;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  specs: ListingSpecs;
}

export interface Spot {
  xMm: number;
  yMm: number;
  rotationDeg: number;
}

export interface Support {
  elevationMm: number;
  /** What the item stands on, such as "east desk" or the key of a placed desk. */
  hostKey?: string;
  hostSource?: "fixture" | "item";
}

/** Wall items hang with their bottom edge here unless a later task gives them a height. */
export const WALL_ITEM_BOTTOM_MM = 1200;
const UNDER_BED_TYPES = new Set(["tote", "basket", "drawer_unit"]);
const SURFACE_FIXTURES = new Set(["desk", "dresser"]);

/** A short readable key from the title, unique within the layout. */
export function itemKeyFor(title: string, layout: PlanLayout, listingId: string): string {
  const existing = layout.items.find((item) => item.source === "listing" && item.listingId === listingId);
  if (existing !== undefined) return existing.key;
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "");
  const taken = new Set(layout.items.map((item) => item.key));
  let key = base || "item";
  for (let suffix = 2; taken.has(key); suffix++) key = `${base}-${suffix}`;
  return key;
}

const normalize = (degrees: number) => ((Math.round(degrees) % 360) + 360) % 360;

/** The layout item for a listing at a spot, before its elevation is known. */
export function layoutItemFor(listing: PlaceableListing, spot: Spot, layout: PlanLayout): LayoutItem {
  const furnitureType = furnitureTypeFor(listing);
  return {
    key: itemKeyFor(listing.title, layout, listing.id),
    source: "listing",
    listingId: listing.id,
    furnitureType,
    ...nounFor(furnitureType, listing.title),
    placement: listing.placement,
    widthMm: listing.widthMm,
    depthMm: listing.depthMm,
    heightMm: listing.heightMm,
    pieces: listing.specs.pieces ?? 1,
    xMm: Math.max(0, Math.round(spot.xMm)),
    yMm: Math.max(0, Math.round(spot.yMm)),
    elevationMm: 0,
    rotationDeg: normalize(spot.rotationDeg),
  };
}

interface Host {
  key: string;
  source: "fixture" | "item";
  polygon: Polygon;
  top: number;
}

function fixtureHosts(room: FitRoom, item: LayoutItem): Host[] {
  return room.geometry.fixtures
    .filter((fixture) => SURFACE_FIXTURES.has(fixture.kind) || (fixture.kind === "bed" && item.furnitureType === "clamp_lamp"))
    .map((fixture) => ({
      key: fixture.label.toLowerCase(),
      source: "fixture" as const,
      polygon: rectangle(fixture.xMm, fixture.yMm, fixture.widthMm, fixture.depthMm, fixture.rotationDeg),
      top: fixture.heightMm,
    }));
}

function itemHosts(layout: PlanLayout, item: LayoutItem): Host[] {
  return layout.items
    .filter((other) => other.key !== item.key && other.placement === "floor" && FURNITURE[other.furnitureType].host)
    .map((other) => ({ key: other.key, source: "item" as const, polygon: footprint(other), top: topMm(other) }));
}

function bedUnder(room: FitRoom, item: LayoutItem): Host | undefined {
  const center = [{ x: item.xMm, y: item.yMm }];
  return room.geometry.fixtures
    .filter((fixture) => fixture.kind === "bed")
    .map((fixture) => ({
      key: fixture.label.toLowerCase(),
      source: "fixture" as const,
      polygon: rectangle(fixture.xMm, fixture.yMm, fixture.widthMm, fixture.depthMm, fixture.rotationDeg),
      top: fixture.heightMm,
    }))
    .find((bed) => contains(bed.polygon, center));
}

/**
 * What an item at its spot stands on. Surface items take the top of a
 * placed host first and then a provided desk or dresser. Undefined means
 * nothing holds it there, which the fit check reports.
 */
export function supportFor(room: FitRoom, layout: PlanLayout, item: LayoutItem): Support | undefined {
  switch (item.placement) {
    case "floor":
    case "underlay":
      return { elevationMm: 0 };
    case "wall":
      return { elevationMm: WALL_ITEM_BOTTOM_MM };
    case "bed": {
      const bed = bedUnder(room, item);
      if (bed === undefined) return undefined;
      const under = UNDER_BED_TYPES.has(item.furnitureType);
      return { elevationMm: under ? 0 : bed.top, hostKey: bed.key, hostSource: "fixture" };
    }
    case "surface": {
      const shape = footprint(item);
      const host = [...itemHosts(layout, item), ...fixtureHosts(room, item)].find((candidate) => contains(candidate.polygon, shape));
      return host === undefined ? undefined : { elevationMm: host.top, hostKey: host.key, hostSource: host.source };
    }
  }
}

/** The item with the elevation of whatever holds it at its spot. */
export function settle(room: FitRoom, layout: PlanLayout, item: LayoutItem): LayoutItem {
  const support = supportFor(room, layout, item);
  return support === undefined ? item : { ...item, elevationMm: support.elevationMm };
}

/** Surface items standing on a placed host, which move with it. */
export function riders(layout: PlanLayout, host: LayoutItem): LayoutItem[] {
  if (host.placement !== "floor" || !FURNITURE[host.furnitureType].host) return [];
  const shape = footprint(host);
  return layout.items.filter(
    (item) =>
      item.key !== host.key &&
      item.placement === "surface" &&
      Math.abs(item.elevationMm - topMm(host)) <= LEVEL_TOLERANCE_MM &&
      contains(shape, footprint(item)),
  );
}

/** Adds the item, or replaces the item with the same key in place. */
export function putItem(layout: PlanLayout, item: LayoutItem): PlanLayout {
  const index = layout.items.findIndex((other) => other.key === item.key);
  if (index < 0) return { items: [...layout.items, item] };
  return { items: layout.items.map((other, position) => (position === index ? item : other)) };
}

export function removeItem(layout: PlanLayout, key: string): PlanLayout {
  return { items: layout.items.filter((item) => item.key !== key) };
}

export interface Move {
  layout: PlanLayout;
  /** The moved item and every rider, in their new spots. */
  moved: LayoutItem[];
}

/**
 * Moves an item to a spot and settles it on whatever is there. Items standing
 * on it turn and shift with it, keeping their place on its top.
 */
export function moveItem(room: FitRoom, layout: PlanLayout, key: string, spot: Spot): Move {
  const item = layout.items.find((candidate) => candidate.key === key);
  if (item === undefined) throw new Error(`No item ${key} in the layout.`);
  const carried = riders(layout, item);
  const carriedKeys = new Set(carried.map((rider) => rider.key));
  const rest: PlanLayout = { items: layout.items.filter((other) => other.key !== key && !carriedKeys.has(other.key)) };
  const placed = settle(room, rest, {
    ...item,
    xMm: Math.max(0, Math.round(spot.xMm)),
    yMm: Math.max(0, Math.round(spot.yMm)),
    rotationDeg: normalize(spot.rotationDeg),
  });
  const turn = ((placed.rotationDeg - item.rotationDeg) * Math.PI) / 180;
  const lift = topMm(placed) - topMm(item);
  const moved = new Map<string, LayoutItem>([[placed.key, placed]]);
  for (const rider of carried) {
    const dx = rider.xMm - item.xMm;
    const dy = rider.yMm - item.yMm;
    moved.set(rider.key, {
      ...rider,
      xMm: Math.max(0, Math.round(placed.xMm + dx * Math.cos(turn) - dy * Math.sin(turn))),
      yMm: Math.max(0, Math.round(placed.yMm + dx * Math.sin(turn) + dy * Math.cos(turn))),
      elevationMm: Math.max(0, rider.elevationMm + lift),
      rotationDeg: normalize(rider.rotationDeg + placed.rotationDeg - item.rotationDeg),
    });
  }
  return {
    layout: { items: layout.items.map((other) => moved.get(other.key) ?? other) },
    moved: [...moved.values()],
  };
}
