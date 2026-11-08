import { BED_MATTRESS_MM } from "@/lib/domain/fit";
import type { Fixture } from "@/lib/domain/room";
import { box, cylinder, look, slab, type Part } from "./parts";
import type { Tone } from "./tones";

/**
 * The furniture the university provides, at its published sizes, in matte mid
 * neutrals so the bright marketplace items read as what Roomover added. The
 * front faces +z, and a bed's front is its foot.
 */

const muted = (tone: Tone) => look(tone, "muted");

function bed(w: number, d: number, h: number): Part[] {
  const deck = h - BED_MATTRESS_MM;
  const post = 55;
  const parts: Part[] = [
    slab([w - 40, 24, d - 60], 0, deck - 24, 0, 4, muted("frame")),
    slab([w - 16, BED_MATTRESS_MM, d - 92], 0, deck, 0, 60, muted("mattress")),
    slab([w - post * 2, 300, 30], 0, deck + 40, -(d / 2 - post / 2), 10, muted("frame")),
    slab([w - post * 2, 150, 30], 0, deck - 30, d / 2 - post / 2, 8, muted("frame")),
  ];
  for (const sx of [-1, 1]) {
    parts.push(slab([40, 140, d - post * 2], sx * (w / 2 - 20), deck - 150, 0, 6, muted("frame")));
    parts.push(slab([post, deck + 360, post], sx * (w / 2 - post / 2), 0, -(d / 2 - post / 2), 10, muted("frame")));
    parts.push(slab([post, deck + 150, post], sx * (w / 2 - post / 2), 0, d / 2 - post / 2, 10, muted("frame")));
  }
  return parts;
}

function desk(w: number, d: number, h: number): Part[] {
  const top = 30;
  const pedestal = w * 0.36;
  const pedestalX = w / 2 - pedestal / 2 - 10;
  const parts: Part[] = [
    slab([w, top, d], 0, h - top, 0, 6, muted("birch")),
    slab([pedestal, h - top - 20, d - 40], pedestalX, 20, -6, 6, muted("birch")),
    slab([w - pedestal - 80, 260, 20], -pedestal / 2 - 10, h - top - 260, -(d / 2 - 40), 4, muted("birch")),
  ];
  const drawer = (h - top - 50) / 3;
  for (let index = 0; index < 3; index++) {
    parts.push(slab([pedestal - 28, drawer - 14, 12], pedestalX, 34 + index * drawer, d / 2 - 20, 4, muted("birch")));
    parts.push(box([80, 12, 10], [pedestalX, 34 + index * drawer + drawer * 0.62, d / 2 - 9], 4, muted("fitting")));
  }
  for (const sz of [-1, 1]) parts.push(slab([40, h - top, 40], -w / 2 + 34, 0, sz * (d / 2 - 34), 4, muted("birch")));
  return parts;
}

function chair(w: number, d: number, h: number): Part[] {
  const seat = Math.min(457, h * 0.55);
  const leg = 30;
  const parts: Part[] = [
    slab([w, 40, d], 0, seat - 40, 0, 10, muted("birch")),
    box([w - 20, 150, leg], [0, h - 75, -(d / 2 - leg / 2 - 4)], 14, muted("birch")),
  ];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) parts.push(slab([leg, seat - 40, leg], sx * (w / 2 - leg / 2 - 4), 0, sz * (d / 2 - leg / 2 - 4), 5, muted("frame")));
    parts.push(slab([leg, h - seat, leg], sx * (w / 2 - leg / 2 - 4), seat, -(d / 2 - leg / 2 - 4), 5, muted("frame")));
  }
  return parts;
}

function wardrobe(w: number, d: number, h: number): Part[] {
  const plinth = 70;
  const parts: Part[] = [
    slab([w - 30, plinth, d - 40], 0, 0, -12, 4, muted("frame")),
    slab([w, h - plinth, d - 24], 0, plinth, -12, 8, muted("birch")),
  ];
  for (const side of [-1, 1]) {
    parts.push(slab([w / 2 - 14, h - plinth - 30, 14], side * (w / 4 + 1), plinth + 15, d / 2 - 17, 6, muted("birch")));
    parts.push(slab([14, 240, 10], side * 26, plinth + (h - plinth) * 0.46, d / 2 - 5, 5, muted("fitting")));
  }
  return parts;
}

function dresser(w: number, d: number, h: number): Part[] {
  const drawers = 3;
  const pitch = (h - 40) / drawers;
  const parts: Part[] = [slab([w, h, d - 14], 0, 0, -7, 10, muted("birch"))];
  for (let index = 0; index < drawers; index++) {
    parts.push(slab([w - 30, pitch - 14, 12], 0, 20 + index * pitch + 7, d / 2 - 8, 5, muted("birch")));
    parts.push(box([60, 10, 2], [0, 20 + index * pitch + pitch * 0.55, d / 2 - 1], 1, muted("fitting")));
  }
  return parts;
}

/** A steam radiator stands as columns, a cooling unit as a cabinet, a baseboard heater as a low box. */
function radiator(w: number, d: number, h: number): Part[] {
  if (d >= 250) {
    const parts: Part[] = [slab([w, h - 6, d], 0, 0, 0, 12, muted("radiator"))];
    for (let index = 0; index < 9; index++) parts.push(slab([16, 6, d * 0.7], -w * 0.4 + (index * w * 0.8) / 8, h - 6, 0, 2, muted("frame")));
    return parts;
  }
  if (h >= 400) {
    const columns = Math.floor(w / 70);
    const pitch = w / columns;
    const parts: Part[] = [
      cylinder(20, w - 20, [0, h - 50, 0], muted("radiator"), { rotation: [0, 0, 90], bevel: 6 }),
      cylinder(20, w - 20, [0, 80, 0], muted("radiator"), { rotation: [0, 0, 90], bevel: 6 }),
    ];
    for (let index = 0; index < columns; index++) parts.push(slab([pitch - 18, h - 50, d], -w / 2 + pitch * (index + 0.5), 50, 0, 18, muted("radiator")));
    return parts;
  }
  return [slab([w, h, d], 0, 0, 0, 8, muted("radiator")), slab([w - 40, 18, 2], 0, h * 0.55, d / 2 - 1, 1, muted("frame"))];
}

export function buildFixture(fixture: Fixture): Part[] {
  const { widthMm: w, depthMm: d, heightMm: h } = fixture;
  switch (fixture.kind) {
    case "bed":
      return bed(w, d, h);
    case "desk":
      return desk(w, d, h);
    case "desk_chair":
      return chair(w, d, h);
    case "wardrobe":
    case "closet":
      return wardrobe(w, d, h);
    case "dresser":
      return dresser(w, d, h);
    case "radiator":
      return radiator(w, d, h);
  }
}
