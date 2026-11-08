import { AA_MINIMUM, contrastRatio, formatRatio, type ContrastUse } from "@/lib/design/contrast";
import {
  BRAND_GROUNDS,
  COLOR,
  CONTRAST_PAIRS,
  FONT_WEIGHTS,
  MOTION,
  PALETTE,
  RADIUS_SCALE,
  SPACING_SCALE,
  SPACING_UNIT_PX,
  SURFACES,
  TYPE_SCALE,
  type ColorToken,
} from "@/lib/design/tokens";

// Tailwind only generates classes it can read in full, so token classes are spelled out.
const SWATCH: Record<ColorToken, string> = {
  paper: "bg-paper text-ink",
  ink: "bg-ink text-paper",
  stone: "bg-stone text-ink",
  flint: "bg-flint text-paper",
  navy: "bg-navy text-paper",
  blue: "bg-blue text-ink",
  sky: "bg-sky text-ink",
  brick: "bg-brick text-paper",
  table: "bg-table text-ink",
  well: "bg-well text-ink",
  key: "bg-key text-paper",
  skirt: "bg-skirt text-ink",
  "brick-skirt": "bg-brick-skirt text-paper",
  "paypal-ground": "bg-paypal-ground text-ink",
};

const NAME: Record<ColorToken, string> = Object.fromEntries(
  [...PALETTE, ...SURFACES, ...BRAND_GROUNDS].map((color) => [color.token, color.name]),
) as Record<ColorToken, string>;

function SwatchGroup({ title, colors }: { title: string; colors: readonly { token: ColorToken; name: string; hex: string; role: string }[] }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">{title}</h3>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4">
        {colors.map((color) => (
          <li key={color.token} className="flex flex-col gap-2">
            <div className={`flex aspect-[2/1] flex-col justify-end rounded-lg p-3 shadow-ring ${SWATCH[color.token]}`}>
              <span className="mono text-xs">{color.hex}</span>
            </div>
            <span className="text-sm font-medium">{color.name}</span>
            <span className="text-sm text-flint">{color.role}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Colors() {
  return (
    <div className="flex flex-col gap-10">
      <SwatchGroup title="Palette" colors={PALETTE} />
      <SwatchGroup title="Surfaces, mixed from the palette" colors={SURFACES} />
      <SwatchGroup title="PayPal mark ground" colors={BRAND_GROUNDS} />
    </div>
  );
}

const USE_LABEL: Record<ContrastUse, string> = {
  body: "Text at any size",
  large: "Text at 24 px and up",
  graphic: "Borders and graphics",
};

export function ContrastTable() {
  return (
    <table className="w-full text-sm">
      <caption className="pb-3 text-left text-base font-semibold">Pairs in use, checked for WCAG AA</caption>
      <thead>
        <tr className="border-b border-stone text-left text-xs text-flint">
          <th scope="col" className="pb-2 font-medium">
            Pair
          </th>
          <th scope="col" className="pb-2 pl-3 font-medium">
            Ratio
          </th>
          <th scope="col" className="hidden pb-2 pl-3 font-medium md:table-cell">
            Where
          </th>
        </tr>
      </thead>
      <tbody>
        {CONTRAST_PAIRS.map((pair) => (
          <tr key={`${pair.foreground}-${pair.background}-${pair.use}`} className="border-b border-hair">
            <th scope="row" className="py-2 text-left font-normal">
              <span className="block font-medium">
                {NAME[pair.foreground]} on {NAME[pair.background]}
              </span>
              <span className="block text-xs text-flint">{USE_LABEL[pair.use]}</span>
            </th>
            <td className="py-2 pl-3 align-top whitespace-nowrap tabular-nums">
              <span className="font-medium">{formatRatio(contrastRatio(COLOR[pair.foreground], COLOR[pair.background]))}</span>
              <span className="text-flint"> of {AA_MINIMUM[pair.use]}</span>
            </td>
            <td className="hidden py-2 pl-3 align-top text-flint md:table-cell">{pair.where}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TYPE_CLASS: Record<(typeof TYPE_SCALE)[number]["token"], string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg font-semibold",
  xl: "text-xl font-semibold",
  "2xl": "text-2xl font-semibold",
  "3xl": "text-3xl font-semibold",
};

const TYPE_SAMPLE: Record<(typeof TYPE_SCALE)[number]["token"], string> = {
  xs: "Nov 23, 2:31 PM",
  sm: "Jun, matches the listing",
  base: "Found a desk that fits under the window. $52 from Jun.",
  lg: "Furnish a room",
  xl: "Harbor Hall 214",
  "2xl": "$141",
  "3xl": "Roomover",
};

export function TypeScale() {
  return (
    <div className="flex flex-col gap-8">
      <ul className="flex flex-col">
        {[...TYPE_SCALE].reverse().map((step) => (
          <li key={step.token} className="grid gap-1 border-b border-hair py-4 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-baseline sm:gap-8">
            <span className="text-xs text-flint tabular-nums">
              {step.token}, {step.px} on {step.lineHeight}
            </span>
            <span className={`${TYPE_CLASS[step.token]} break-words`}>{TYPE_SAMPLE[step.token]}</span>
          </li>
        ))}
      </ul>
      <ul className="flex flex-col gap-2">
        {FONT_WEIGHTS.map((weight) => (
          <li key={weight.token} className="flex flex-wrap items-baseline gap-x-3">
            <span className={`text-lg ${weight.token === "normal" ? "font-normal" : weight.token === "medium" ? "font-medium" : "font-semibold"}`}>
              {weight.weight}
            </span>
            <span className="text-sm text-flint">{weight.use}</span>
          </li>
        ))}
        <li className="flex flex-wrap items-baseline gap-x-3">
          <span className="mono text-lg">0TF88542GM8203619</span>
          <span className="text-sm text-flint">MONO axis, for sandbox IDs and times only</span>
        </li>
      </ul>
    </div>
  );
}

const RADIUS_CLASS: Record<(typeof RADIUS_SCALE)[number]["token"], string> = {
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  "3xl": "rounded-3xl",
};

export function Shape() {
  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Spacing, in steps of {SPACING_UNIT_PX} px</h3>
        <ul className="flex flex-col gap-2">
          {SPACING_SCALE.map((step) => (
            <li key={step} className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-4 text-sm tabular-nums">
              {step * SPACING_UNIT_PX} px
              <span className="h-2 rounded-sm bg-ink" style={{ width: step * SPACING_UNIT_PX }} />
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Radius grows with the surface</h3>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {RADIUS_SCALE.map((radius) => (
            <li key={radius.token} className="flex flex-col gap-2">
              <span className={`h-16 bg-paper shadow-sheet ${RADIUS_CLASS[radius.token]}`} />
              <span className="text-sm font-medium">{radius.px} px</span>
              <span className="text-sm text-flint">{radius.use}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function MotionTokens() {
  return (
    <ul className="grid gap-6 sm:grid-cols-3">
      {MOTION.map((motion) => (
        <li key={motion.token} className="flex flex-col gap-1">
          <span className="text-base font-semibold">
            {motion.token} <span className="font-normal text-flint tabular-nums">{motion.ms} ms</span>
          </span>
          <span className="text-sm text-flint">{motion.use}</span>
        </li>
      ))}
    </ul>
  );
}
