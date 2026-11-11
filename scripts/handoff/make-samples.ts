import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

/**
 * Builds the sample handoff photos judges can use in place of a camera.
 * Each one starts from a seed listing photo (CC0 1.0) and gets its own crop,
 * a slight turn, and different light, the way a second photo of the same
 * item looks. The mesh desk chair also gets a copy with a small tear in the
 * seat vinyl, and the navy bean bag one with a split in its side that shows
 * the white filling beads. Chromium's canvas does the drawing, so nothing new
 * installs.
 *
 *   pnpm handoff:samples
 */

const SOURCE = "public/seed/listings";
const OUT = "public/handoff-samples";
const MAX_EDGE = 1100;
const QUALITY = 0.86;

interface Look {
  /** Share of the source kept, 0 to 1. */
  keep: number;
  /** Where the crop sits inside the source, -1 to 1 on each axis. */
  shiftX: number;
  shiftY: number;
  turnDeg: number;
  /** CSS filter for the new light. */
  filter: string;
  /** A wash over the whole photo, such as cool daylight or warm lamplight. */
  wash: string;
}

const LIGHTS: readonly Pick<Look, "filter" | "wash">[] = [
  { filter: "brightness(1.1) contrast(0.94) saturate(0.92)", wash: "rgba(255, 236, 205, 0.10)" },
  { filter: "brightness(0.9) contrast(1.05) saturate(1.04)", wash: "rgba(205, 222, 255, 0.10)" },
  { filter: "brightness(1.04) contrast(1.02) saturate(0.86)", wash: "rgba(255, 246, 232, 0.06)" },
  { filter: "brightness(0.95) contrast(0.97) saturate(1.08)", wash: "rgba(255, 214, 170, 0.10)" },
];

/** A fixed look per photo, so a rerun writes the same files. */
function lookFor(index: number): Look {
  const light = LIGHTS[index % LIGHTS.length];
  return {
    keep: 0.86 + ((index * 7) % 5) * 0.015,
    shiftX: [-0.8, 0.6, -0.3, 0.9, 0.1][index % 5],
    shiftY: [0.5, -0.6, 0.8, -0.2, -0.9][index % 5],
    turnDeg: [-2.2, 1.6, -1.1, 2.4, 0.8, -1.8][index % 6],
    ...light,
  };
}

interface Tear {
  slug: string;
  /** Where the split starts, in source pixels. */
  x: number;
  y: number;
  lengthPx: number;
  /** How far the split drops per pixel it runs, negative when it climbs to the right. */
  slope: number;
  /** Gap and lip widths relative to the chair's split. */
  scale: number;
  /** Seat foam shows through the chair. Filling beads show through the bean bag and spill onto its side. */
  inside: "foam" | "beads";
}

/** The chair seat is about 1 px per mm, the bean bag's side about 0.8 px per mm, so its split runs about 15 cm. */
const TEARS: readonly Tear[] = [
  { slug: "marcus-mesh-desk-chair", x: 542, y: 672, lengthPx: 36, slope: 0.18, scale: 1, inside: "foam" },
  { slug: "lea-navy-bean-bag", x: 268, y: 440, lengthPx: 118, slope: -0.2, scale: 2.4, inside: "beads" },
];

const INSIDE = {
  foam: { rim: "rgb(22, 21, 23)", gap: "rgb(122, 112, 92)", core: "rgb(168, 156, 128)", speck: "rgba(196, 184, 154, 0.85)", lip: "rgba(132, 131, 134, 0.8)" },
  beads: { rim: "rgb(9, 11, 19)", gap: "rgb(58, 62, 74)", lip: "rgba(92, 104, 144, 0.5)" },
} as const;

async function main() {
  await mkdir(OUT, { recursive: true });
  const files = (await readdir(SOURCE)).filter((file) => file.endsWith(".jpg")).sort();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<canvas></canvas>");
  // tsx keeps function names with a helper the page does not have.
  await page.evaluate("globalThis.__name = (fn) => fn");

  const render = async (file: string, look: Look, tear: Tear | null): Promise<Buffer> => {
    const source = `data:image/jpeg;base64,${(await readFile(join(SOURCE, file))).toString("base64")}`;
    const dataUrl = await page.evaluate(
      async ({ source, look, tear, inside, maxEdge, quality }) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const base = document.createElement("canvas");
        base.width = image.naturalWidth;
        base.height = image.naturalHeight;
        const paint = base.getContext("2d") as CanvasRenderingContext2D;
        paint.drawImage(image, 0, 0);

        if (tear !== null) {
          // The split is a tapered gap with a dark rim, pale filling inside, and a lifted lip that catches the light.
          const size = tear.scale;
          const colors = inside[tear.inside];
          const count = 14;
          const jitter = [0, 0.3, -0.2, 0.4, -0.1, 0.3, -0.3, 0.2, 0.4, -0.3, 0.1, -0.2, 0.2, 0];
          const spine = Array.from({ length: count }, (_, i) => {
            const t = i / (count - 1);
            return { t, x: tear.x + t * tear.lengthPx, y: tear.y + t * tear.lengthPx * tear.slope + Math.sin(t * Math.PI) * (3 * size) + jitter[i] * size };
          });
          // The bean bag's vinyl tore unevenly, so its edges wander. The chair's split stays smooth.
          const rough = tear.inside === "beads" ? [0, 0.32, -0.24, 0.18, 0.36, -0.2, 0.12, 0.4, -0.28, 0.22, -0.14, 0.3, -0.18, 0] : null;
          const edge = (half: number, side: 1 | -1) =>
            spine.map((point, i) => {
              const width = rough === null ? half : half * (1 + rough[i] * (side === 1 ? 1 : -0.6));
              return { x: point.x + side * 0.15 * width, y: point.y + side * width * Math.pow(Math.sin(point.t * Math.PI), 0.7) };
            });
          const outline = (half: number) => {
            const upper = edge(half, -1);
            const lower = edge(half * 0.8, 1).reverse();
            paint.beginPath();
            [...upper, ...lower].forEach((point, i) => (i === 0 ? paint.moveTo(point.x, point.y) : paint.lineTo(point.x, point.y)));
            paint.closePath();
          };
          const fill = (half: number, color: string) => {
            outline(half);
            paint.fillStyle = color;
            paint.fill();
          };
          // The vinyl dips around the split.
          const mid = spine[Math.floor(count / 2)];
          const dip = paint.createRadialGradient(mid.x, mid.y + 2 * size, 2 * size, mid.x, mid.y + 2 * size, tear.lengthPx * 0.7);
          dip.addColorStop(0, "rgba(20, 20, 22, 0.28)");
          dip.addColorStop(1, "rgba(20, 20, 22, 0)");
          paint.fillStyle = dip;
          paint.fillRect(mid.x - tear.lengthPx, mid.y - tear.lengthPx, tear.lengthPx * 2, tear.lengthPx * 2);
          paint.save();
          paint.shadowColor = "rgba(0, 0, 0, 0.5)";
          paint.shadowBlur = 2.5 * size;
          fill(4.6 * size, colors.rim);
          paint.restore();
          if (tear.inside === "foam") {
            fill(1.9 * size, colors.gap);
            fill(0.9 * size, inside.foam.core);
            // Specks of foam where the gap is widest.
            paint.fillStyle = inside.foam.speck;
            for (const i of [5, 7, 8]) paint.fillRect(spine[i].x - 0.5, spine[i].y - 0.4, 1.1, 0.9);
          } else {
            // A fixed seed, so a rerun writes the same file.
            let seed = 20_261_110;
            const random = () => (seed = (seed * 16_807) % 2_147_483_647) / 2_147_483_647;
            const bead = (x: number, y: number, radius: number, tone: number) => {
              paint.beginPath();
              paint.arc(x, y, radius, 0, Math.PI * 2);
              paint.fillStyle = `rgb(${tone}, ${tone}, ${tone - 5})`;
              paint.fill();
              paint.lineWidth = 0.16 * size;
              paint.strokeStyle = "rgba(34, 38, 52, 0.55)";
              paint.stroke();
            };
            // White filling beads pack the opening, shaded toward its rim.
            paint.save();
            outline(3.1 * size);
            paint.clip();
            paint.fillStyle = colors.gap;
            paint.fillRect(tear.x - 10 * size, Math.min(tear.y, tear.y + tear.lengthPx * tear.slope) - 12 * size, tear.lengthPx + 20 * size, Math.abs(tear.lengthPx * tear.slope) + 24 * size);
            for (let n = 0; n < 150; n += 1) {
              const t = random();
              const point = { x: tear.x + t * tear.lengthPx, y: tear.y + t * tear.lengthPx * tear.slope + Math.sin(t * Math.PI) * (3 * size) };
              const across = (random() - 0.5) * 7 * size;
              bead(point.x + (random() - 0.5) * 2 * size, point.y + across, (0.55 + random() * 0.3) * size, 214 + Math.round(random() * 34));
            }
            paint.restore();
            // A few beads spilled out and cling to the vinyl under the split.
            for (let n = 0; n < 9; n += 1) {
              const i = 4 + Math.floor(random() * 6);
              const x = spine[i].x + (random() - 0.5) * 5 * size;
              const y = spine[i].y + (3.4 + random() * 7) * size;
              const radius = (0.55 + random() * 0.25) * size;
              paint.beginPath();
              paint.arc(x + 0.3 * size, y + 0.35 * size, radius, 0, Math.PI * 2);
              paint.fillStyle = "rgba(4, 6, 14, 0.4)";
              paint.fill();
              bead(x, y, radius, 228 + Math.round(random() * 20));
            }
          }
          // The upper lip lifts a little and catches the light.
          const lip = edge(5.6 * size, -1);
          paint.beginPath();
          lip.forEach((point, i) => (i === 0 ? paint.moveTo(point.x, point.y) : paint.lineTo(point.x, point.y)));
          paint.lineWidth = (tear.inside === "foam" ? 1.1 : 0.6) * size;
          paint.strokeStyle = colors.lip;
          paint.stroke();
        }

        const cropW = base.width * look.keep;
        const cropH = base.height * look.keep;
        const left = ((base.width - cropW) / 2) * (1 + look.shiftX);
        const top = ((base.height - cropH) / 2) * (1 + look.shiftY);
        const scale = Math.min(1, maxEdge / Math.max(cropW, cropH));
        const out = document.createElement("canvas");
        out.width = Math.round(cropW * scale);
        out.height = Math.round(cropH * scale);
        const draw = out.getContext("2d") as CanvasRenderingContext2D;
        draw.filter = look.filter;
        // Turning about the center and drawing a little larger keeps the corners filled.
        const turn = (look.turnDeg * Math.PI) / 180;
        const grow = 1 + Math.abs(Math.sin(turn)) * 1.6;
        draw.translate(out.width / 2, out.height / 2);
        draw.rotate(turn);
        draw.scale(scale * grow, scale * grow);
        draw.drawImage(base, -left - cropW / 2, -top - cropH / 2);
        draw.setTransform(1, 0, 0, 1, 0, 0);
        draw.filter = "none";
        draw.fillStyle = look.wash;
        draw.fillRect(0, 0, out.width, out.height);
        return out.toDataURL("image/jpeg", quality);
      },
      { source, look, tear, inside: INSIDE, maxEdge: MAX_EDGE, quality: QUALITY },
    );
    return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  };

  try {
    for (const [index, file] of files.entries()) {
      const look = lookFor(index);
      await writeFile(join(OUT, file), await render(file, look, null));
      const tear = TEARS.find((candidate) => file === `${candidate.slug}.jpg`);
      if (tear !== undefined) await writeFile(join(OUT, `${tear.slug}-torn.jpg`), await render(file, look, tear));
    }
  } finally {
    await browser.close();
  }
  console.log(`Wrote ${files.length + TEARS.length} sample photos to ${OUT}.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
