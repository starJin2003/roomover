import { PIECE_GAP_MM, type FurnitureType } from "@/lib/domain/furniture";
import { box, cylinder, lathe, look, rod, slab, sphere, type Part } from "./parts";
import type { ItemTones, Tone } from "./tones";

/**
 * Marketplace furniture, built at the listing's true size. Every builder
 * keeps its parts inside width by height by depth, with the front at +z.
 * Glossy toy plastic carries hard goods and a soft fabric finish carries
 * upholstery and bedding.
 */

export interface Size {
  width: number;
  depth: number;
  height: number;
}

/** The mattress an item of bedding lies on, in the bedding's own axes. */
export interface BedHost {
  width: number;
  length: number;
}

type Builder = (size: Size, tones: ItemTones, piece: number) => Part[];

const toy = (tone: Tone) => look(tone, "toy");
const fabric = (tone: Tone) => look(tone, "fabric");
const second = (tones: ItemTones, fallback: Tone): Tone => tones[1] ?? fallback;

const desk: Builder = ({ width: w, depth: d, height: h }, tones) => {
  const top = 32;
  const legR = Math.min(22, Math.max(14, w * 0.016));
  const inset = legR + 26;
  const apronDepth = d - inset * 2;
  const parts = [
    slab([w, top, d], 0, h - top, 0, 10, toy(tones[0])),
    slab([w - inset * 2, 110, apronDepth], 0, h - top - 110, 0, 6, toy(tones[0])),
  ];
  for (const x of [-w / 3, 0, w / 3]) {
    parts.push(box([72, 12, 10], [x, h - top - 55, apronDepth / 2 + 5], 4, toy(second(tones, "graphite"))));
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(cylinder(legR * 0.72, h - top, [sx * (w / 2 - inset), (h - top) / 2, sz * (d / 2 - inset)], toy(second(tones, "oak")), { radiusTop: legR, bevel: 3 }));
    }
  }
  return parts;
};

const deskChair: Builder = ({ width: w, depth: d, height: h }, tones) => {
  const seat = Math.min(480, h * 0.5);
  const reach = Math.min(w, d) * 0.44;
  const frame = toy(tones[0]);
  const parts: Part[] = [];
  for (let spoke = 0; spoke < 5; spoke++) {
    const angle = (spoke / 5) * Math.PI * 2 + Math.PI / 2;
    const length = reach - 20;
    parts.push(box([length, 26, 34], [(Math.cos(angle) * length) / 2, 66, (Math.sin(angle) * length) / 2], 10, frame, [0, (-angle * 180) / Math.PI, 0]));
    parts.push(sphere(22, [Math.cos(angle) * (reach - 22), 22, Math.sin(angle) * (reach - 22)], toy("ink")));
  }
  parts.push(cylinder(22, seat - 110, [0, 80 + (seat - 110) / 2, 0], toy("stone"), { bevel: 4 }));
  parts.push(box([w * 0.8, 78, d * 0.76], [0, seat, d * 0.06], 32, fabric(second(tones, "stone"))));
  parts.push(box([62, 230, 30], [0, seat + 80, -d / 2 + 80], 10, frame));
  parts.push(slab([w * 0.74, h - seat - 90, 56], 0, seat + 90, -d / 2 + 60, 28, frame));
  for (const side of [-1, 1]) {
    parts.push(slab([34, 170, 34], side * (w / 2 - 40), seat + 30, d * 0.02, 10, frame));
    parts.push(slab([50, 28, d * 0.42], side * (w / 2 - 40), seat + 200, d * 0.04, 12, frame));
  }
  return parts;
};

function plainChair({ width: w, depth: d, height: h }: Size, frameTone: Tone, seatTone: Tone, seatFinish: "toy" | "fabric" | "muted", frameFinish: "toy" | "muted"): Part[] {
  const seat = Math.min(470, h * 0.52);
  const leg = 34;
  const frame = look(frameTone, frameFinish);
  const parts: Part[] = [
    slab([w, 40, d], 0, seat - 40, 0, 8, frame),
    slab([w - 36, 56, d - 46], 0, seat, 12, 22, look(seatTone, seatFinish)),
    box([w - 24, 118, leg], [0, h - 59, -(d / 2 - leg / 2 - 6)], 12, frame),
    box([w - 70, 36, leg - 6], [0, seat + (h - seat) * 0.42, -(d / 2 - leg / 2 - 6)], 10, frame),
  ];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(slab([leg, seat - 40, leg], sx * (w / 2 - leg / 2 - 6), 0, sz * (d / 2 - leg / 2 - 6), 6, frame));
    }
    parts.push(slab([leg, h - seat, leg], sx * (w / 2 - leg / 2 - 6), seat, -(d / 2 - leg / 2 - 6), 6, frame));
  }
  return parts;
}

const sideChair: Builder = (size, tones) => plainChair(size, tones[0], second(tones, "stone"), "fabric", "toy");

const armchair: Builder = ({ width: w, depth: d, height: h }, tones) => {
  const cloth = fabric(tones[0]);
  const foot = 90;
  const arm = 120;
  const parts: Part[] = [
    slab([w, 300, d - 40], 0, foot, 20, 50, cloth),
    slab([w - arm * 2, 110, d - 240], 0, foot + 300, 100, 40, cloth),
    slab([w - 40, h - foot, 170], 0, foot, -(d / 2 - 85), 60, cloth),
  ];
  for (const side of [-1, 1]) {
    parts.push(slab([arm, 560, d - 110], side * (w / 2 - arm / 2), foot, 35, 50, cloth));
    parts.push(box([90, 330, 260], [side * (w / 2 - 45), h - 265, -(d / 2 - 200)], 40, cloth));
    for (const sz of [-1, 1]) {
      parts.push(cylinder(17, foot, [side * (w / 2 - 70), foot / 2, sz * (d / 2 - 70)], toy(second(tones, "oak")), { radiusTop: 23, bevel: 3 }));
    }
  }
  return parts;
};

/** A slouched seat with a soft back rising behind it, and the matching pouf in the free corner. */
const beanBag: Builder = ({ width: w, depth: d, height: h }, tones) => {
  const cloth = fabric(tones[0]);
  const seat = Math.min(w, d) * 0.8;
  const offset = Math.min(w, d) / 2 - seat / 2;
  const pouf = Math.min(w, d) * 0.17;
  const poufHeight = Math.min(300, h * 0.38);
  return [
    box([seat, h * 0.46, seat], [-offset, h * 0.23, -offset], h * 0.2, cloth),
    box([seat * 0.92, h * 0.74, seat * 0.42], [-offset, h * 0.59, -offset - seat * 0.19], seat * 0.19, cloth, [-14, 0, 0]),
    cylinder(pouf, poufHeight, [w / 2 - pouf, poufHeight / 2, d / 2 - pouf], fabric(second(tones, tones[0])), { radiusTop: pouf * 0.95, bevel: 55 }),
  ];
};

const pouf: Builder = ({ width: w, height: h }, tones, piece) => [
  cylinder(w / 2, h, [0, h / 2, 0], fabric(tones[piece % tones.length]), { radiusTop: (w / 2) * 0.95, bevel: Math.min(90, h * 0.3) }),
];

const BOOK_TONES: readonly Tone[] = ["paper", "sand", "graphite", "stone", "linen"];

const bookcase: Builder = ({ width: w, depth: d, height: h }, tones, piece) => {
  const wood = toy(tones[0]);
  const board = 18;
  const plinth = 60;
  const bays = 4;
  const bay = (h - plinth - board) / bays;
  const parts: Part[] = [
    slab([w, board, d], 0, h - board, 0, 3, wood),
    slab([w - board * 2, plinth, d - 20], 0, 0, 10, 2, wood),
    slab([w - board * 2, h - board - plinth, 8], 0, plinth, -(d / 2 - 4), 1, wood),
  ];
  for (const side of [-1, 1]) parts.push(slab([board, h - board, d], side * (w / 2 - board / 2), 0, 0, 3, wood));
  for (let shelf = 1; shelf < bays; shelf++) parts.push(slab([w - board * 2, board, d - 20], 0, plinth + bay * shelf, 10, 2, wood));
  for (let level = 0; level < bays - 1; level++) {
    let x = -w / 2 + board + 12;
    const floor = plinth + (level === 0 ? 0 : bay * level + board);
    const room = bay - (level === 0 ? 0 : board);
    for (let index = 0; index < 4 + ((level + piece) % 2); index++) {
      const thickness = 28 + ((index * 7 + level * 5 + piece * 3) % 18);
      const tall = room * (0.62 + (((index + level + piece) * 37) % 25) / 100);
      if (x + thickness > w / 2 - board - 12) break;
      parts.push(slab([thickness, tall, d - 70], x + thickness / 2, floor, 4, 4, toy(BOOK_TONES[(index + level * 2 + piece) % BOOK_TONES.length])));
      x += thickness + 2;
    }
  }
  return parts;
};

const deskLamp: Builder = ({ width: w, depth: d, height: h }, tones) => {
  const metal = toy(tones[0]);
  const joint = toy(second(tones, "oak"));
  const base = Math.min(d / 2 - 2, 88);
  const x0 = -w / 2 + base;
  const elbow: [number, number] = [x0 + w * 0.12, h * 0.72];
  const head: [number, number] = [w / 2 - 70, h - 16];
  return [
    cylinder(base, 26, [x0, 13, 0], metal, { radiusTop: base * 0.9, bevel: 6 }),
    sphere(16, [x0, 42, 0], joint),
    rod([x0, 42], elbow, 0, 8, metal),
    sphere(15, [elbow[0], elbow[1], 0], joint),
    rod(elbow, head, 0, 7, metal),
    sphere(14, [head[0], head[1], 0], joint),
    cylinder(70, 110, [head[0], head[1] - 65, 0], metal, { radiusTop: 22, bevel: 4 }),
  ];
};

const tableLamp: Builder = ({ width: w, height: h }, tones) => {
  const radius = w / 2;
  const shade = h * 0.42;
  const body = toy(tones[0]);
  return [
    cylinder(radius * 0.42, 24, [0, 12, 0], body, { bevel: 6 }),
    lathe(
      [
        [0, 0],
        [radius * 0.3, 0],
        [radius * 0.42, 60],
        [radius * 0.4, 150],
        [radius * 0.18, 230],
        [radius * 0.1, 260],
        [0, 260],
      ],
      [0, 24, 0],
      body,
    ),
    cylinder(8, 80, [0, 324, 0], body, { bevel: 3 }),
    cylinder(radius, shade, [0, h - shade / 2, 0], fabric(second(tones, "paper")), { radiusTop: radius * 0.72, bevel: 3 }),
  ];
};

const clampLamp: Builder = ({ width: w, height: h }, tones) => {
  const metal = toy(tones[0]);
  const stemX = -w / 2 + 28;
  return [
    slab([56, 62, 56], stemX, 0, 0, 10, metal),
    rod([stemX, 60], [stemX, h * 0.62], 0, 9, metal),
    rod([stemX, h * 0.62], [-17, h - 22], 0, 8, metal),
    cylinder(56, 100, [2, h - 68, 0], metal, { radiusTop: 24, bevel: 4, rotation: [0, 0, 22] }),
  ];
};

const floorLamp: Builder = ({ width: w, height: h }, tones) => {
  const radius = w / 2;
  const shade = Math.min(300, h * 0.2);
  const metal = toy(second(tones, tones[0]));
  return [
    cylinder(radius * 0.85, 28, [0, 14, 0], metal, { radiusTop: radius * 0.8, bevel: 8 }),
    cylinder(11, h - shade - 28 + 40, [0, 28 + (h - shade + 12) / 2, 0], metal, { bevel: 4 }),
    cylinder(radius, shade, [0, h - shade / 2, 0], fabric(tones[0]), { radiusTop: radius * 0.62, bevel: 4 }),
  ];
};

const rug: Builder = ({ width: w, depth: d, height: h }, tones) => {
  const border = Math.min(140, Math.max(40, Math.min(w, d) * 0.06));
  return [
    slab([w, h, d], 0, 0, 0, Math.min(3, h / 2), fabric(tones[0])),
    slab([w - border * 2, 1, d - border * 2], 0, h - 0.5, 0, 0.5, fabric(second(tones, "linen"))),
  ];
};

const roundRug: Builder = ({ width: w, height: h }, tones) => [
  cylinder(w / 2, h, [0, h / 2, 0], fabric(tones[0]), { bevel: 1.5 }),
  cylinder((w / 2) * 0.62, 1, [0, h, 0], fabric(second(tones, "linen")), { bevel: 0 }),
];

const miniFridge: Builder = ({ width: w, depth: d, height: h }, tones) => {
  const shell = toy(tones[0]);
  const parts: Part[] = [
    slab([w, h - 20, d - 30], 0, 20, -15, 26, shell),
    slab([w - 16, h - 44, 18], 0, 30, d / 2 - 21, 16, shell),
    slab([14, (h - 44) * 0.42, 12], w / 2 - 46, 20 + (h - 20) * 0.42, d / 2 - 6, 5, toy(second(tones, "stone"))),
  ];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) parts.push(cylinder(14, 20, [sx * (w / 2 - 40), 10, sz * (d / 2 - 50)], toy("ink"), { bevel: 3 }));
  }
  return parts;
};

const drawerUnit: Builder = ({ width: w, depth: d, height: h }, tones) => {
  const drawers = 4;
  const pitch = (h - 36) / drawers;
  const parts: Part[] = [slab([w, h, d - 12], 0, 0, -6, 14, toy(tones[0]))];
  for (let index = 0; index < drawers; index++) {
    parts.push(slab([w - 36, pitch - 12, 12], 0, 18 + index * pitch + 6, d / 2 - 6, 6, toy(second(tones, "paper"))));
  }
  return parts;
};

const basket: Builder = ({ width: w, height: h }, tones, piece) => {
  const radius = w / 2;
  const wall = 16;
  return [
    lathe(
      [
        [0, 0],
        [radius * 0.86, 0],
        [radius * 0.92, 8],
        [radius, h - 10],
        [radius * 0.99, h],
        [radius - wall, h],
        [radius * 0.88 - wall, wall + 10],
        [0, wall + 10],
      ],
      [0, 0, 0],
      fabric(tones[piece % tones.length]),
    ),
  ];
};

const tote: Builder = ({ width: w, depth: d, height: h }, tones) => [
  slab([w * 0.94, h - 34, d * 0.92], 0, 0, 0, 22, toy(tones[0])),
  slab([w, 26, d], 0, h - 34, 0, 12, toy(tones[0])),
  slab([w * 0.7, 8, d * 0.55], 0, h - 8, 0, 4, toy(tones[0])),
];

const BUILDERS: Readonly<Record<Exclude<FurnitureType, "comforter" | "pillows" | "throw">, Builder>> = {
  desk,
  desk_chair: deskChair,
  side_chair: sideChair,
  armchair,
  bean_bag: beanBag,
  pouf,
  bookcase,
  desk_lamp: deskLamp,
  table_lamp: tableLamp,
  clamp_lamp: clampLamp,
  floor_lamp: floorLamp,
  rug,
  round_rug: roundRug,
  mini_fridge: miniFridge,
  drawer_unit: drawerUnit,
  basket,
  tote,
};

/**
 * Bedding follows the mattress it lies on. A comforter covers the foot end
 * and hangs over three edges, pillows stack at the head, and a throw lies
 * folded across the bed.
 */
function bedding(type: "comforter" | "pillows" | "throw", size: Size, pieces: number, host: BedHost | undefined, tones: ItemTones): Part[] {
  const width = host?.width ?? size.width;
  const length = host?.length ?? size.depth;
  const cloth = fabric(tones[0]);
  if (type === "comforter") {
    const cover = length * 0.74;
    const center = length / 2 - cover / 2;
    return [
      slab([width + 30, 60, cover], 0, 0, center, 30, cloth),
      slab([width + 34, 66, 130], 0, 4, center - cover / 2 + 65, 33, fabric(second(tones, "paper"))),
      slab([22, 260, cover], -(width / 2 + 4), -220, center, 10, cloth),
      slab([22, 260, cover], width / 2 + 4, -220, center, 10, cloth),
      slab([width + 30, 260, 22], 0, -220, length / 2 + 4, 10, cloth),
    ];
  }
  if (type === "pillows") {
    const across = Math.min(size.depth, width - 60);
    const sideBySide = width >= across * 2 + 60;
    return Array.from({ length: pieces }, (_, index) => {
      const row = sideBySide ? Math.floor(index / 2) : index;
      const x = sideBySide && index < 2 ? (index === 0 ? -1 : 1) * (across / 2 + 10) : 0;
      return box([across, 130, size.width * 0.94], [x, 60 + row * 108, 0], 58, fabric(tones[index % tones.length]), [0, index % 2 === 0 ? -4 : 5, 0]);
    });
  }
  return [
    slab([width + 30, 40, 380], 0, 0, 0, 16, cloth),
    slab([width + 32, 8, 70], 0, 34, 80, 4, fabric(second(tones, "oak"))),
    slab([20, 180, 380], -(width / 2 + 5), -150, 0, 8, cloth),
    slab([20, 180, 380], width / 2 + 5, -150, 0, 8, cloth),
  ];
}

/** Builds a listing's model. Sets of pieces stand in a row along the width, `PIECE_GAP_MM` apart. */
export function buildFurniture(type: FurnitureType, size: Size, pieces: number, tones: ItemTones, host?: BedHost): Part[] {
  if (type === "comforter" || type === "pillows" || type === "throw") return bedding(type, size, pieces, host, tones);
  const build = BUILDERS[type];
  const row = size.width * pieces + PIECE_GAP_MM * (pieces - 1);
  return Array.from({ length: pieces }, (_, piece) => {
    const offset = -row / 2 + size.width / 2 + piece * (size.width + PIECE_GAP_MM);
    return build(size, tones, piece).map((part) => ({ ...part, at: [part.at[0] + offset, part.at[1], part.at[2]] as const }));
  }).flat();
}
