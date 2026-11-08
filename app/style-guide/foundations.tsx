import { AA_MINIMUM, contrastRatio, formatRatio, type ContrastUse } from "@/lib/design/contrast";
import {
  COLOR,
  CONTRAST_PAIRS,
  MOTION,
  PALETTE,
  RADIUS_SCALE,
  SPACING_SCALE,
  SPACING_UNIT_PX,
  TYPE_SCALE,
  type ColorToken,
} from "@/lib/design/tokens";

// Tailwind only generates classes it can read in full, so token classes are spelled out.
const BACKGROUND: Record<ColorToken, string> = {
  paper: "bg-paper border border-stone",
  ink: "bg-ink",
  stone: "bg-stone",
  flint: "bg-flint",
  navy: "bg-navy",
  blue: "bg-blue",
  sky: "bg-sky",
  brick: "bg-brick",
};

const TEXT: Record<ColorToken, string> = {
  paper: "text-paper",
  ink: "text-ink",
  stone: "text-stone",
  flint: "text-flint",
  navy: "text-navy",
  blue: "text-blue",
  sky: "text-sky",
  brick: "text-brick",
};

const LABEL_ON: Record<ColorToken, ColorToken> = {
  paper: "ink",
  ink: "paper",
  stone: "ink",
  flint: "paper",
  navy: "paper",
  blue: "ink",
  sky: "ink",
  brick: "paper",
};

const NAME: Record<ColorToken, string> = Object.fromEntries(PALETTE.map((color) => [color.token, color.name])) as Record<
  ColorToken,
  string
>;

export function ColorSwatches() {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
      {PALETTE.map((color) => (
        <li key={color.token} className="flex flex-col gap-3">
          <div
            className={`flex aspect-[5/4] flex-col justify-between rounded-lg p-3 shadow-key-tall sm:p-4 ${BACKGROUND[color.token]} ${TEXT[LABEL_ON[color.token]]}`}
          >
            <span className="text-md font-bold sm:text-lg">{color.name}</span>
            <span className="mono text-xs sm:text-sm">{color.hex}</span>
          </div>
          <p className="text-sm text-flint">{color.role}</p>
        </li>
      ))}
    </ul>
  );
}

const USE_LABEL: Record<ContrastUse, string> = {
  body: "Text at any size",
  large: "Text at 24 px and up",
  graphic: "Borders and graphics",
};

const REJECTED: readonly { foreground: ColorToken; background: ColorToken; reason: string }[] = [
  { foreground: "stone", background: "paper", reason: "Body text. Flint replaces it." },
  { foreground: "blue", background: "paper", reason: "Any text. Blue carries Ink text as a fill." },
  { foreground: "paper", background: "blue", reason: "Any text. Ink reads on blue instead." },
  { foreground: "sky", background: "paper", reason: "Any text or boundary. Sky stays in the 3D room." },
];

function Sample({ foreground, background, use }: { foreground: ColorToken; background: ColorToken; use?: ContrastUse }) {
  if (use === "graphic") {
    return (
      <span className={`inline-flex h-8 w-12 items-center justify-center rounded-sm ${BACKGROUND[background]}`}>
        <span className={`h-4 w-8 rounded-sm border-2 ${foreground === "blue" ? "border-blue" : "border-stone"}`} />
      </span>
    );
  }
  // A large text pair is shown at 24 px bold, the size it is allowed at.
  const size = use === "large" ? "text-xl" : "text-sm";
  return (
    <span
      className={`inline-flex h-8 w-12 items-center justify-center rounded-sm font-bold ${size} ${BACKGROUND[background]} ${TEXT[foreground]}`}
    >
      Aa
    </span>
  );
}

export function ContrastTable() {
  return (
    <div className="flex flex-col gap-10">
      <table className="w-full text-sm">
        <caption className="pb-3 text-left text-md font-semibold">Pairs in use, checked for WCAG AA</caption>
        <thead>
          <tr className="border-b border-stone text-left text-xs text-flint">
            <th scope="col" className="pb-2 font-semibold">
              Pair
            </th>
            <th scope="col" className="pb-2 pl-3 font-semibold">
              Ratio
            </th>
            <th scope="col" className="hidden pb-2 pl-3 font-semibold sm:table-cell">
              Allowed for
            </th>
            <th scope="col" className="hidden pb-2 pl-3 font-semibold md:table-cell">
              Where
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone/30">
          {CONTRAST_PAIRS.map((pair) => {
            const ratio = contrastRatio(COLOR[pair.foreground], COLOR[pair.background]);
            return (
              <tr key={`${pair.foreground}-${pair.background}-${pair.use}`}>
                <th scope="row" className="py-2.5 text-left font-normal">
                  <span className="flex items-center gap-3">
                    <Sample {...pair} />
                    <span>
                      <span className="block font-semibold">
                        {NAME[pair.foreground]} on {NAME[pair.background]}
                      </span>
                      <span className="block text-xs text-flint sm:hidden">{USE_LABEL[pair.use]}</span>
                    </span>
                  </span>
                </th>
                <td className="py-2.5 pl-3 align-middle whitespace-nowrap tabular-nums">
                  <span className="font-semibold">{formatRatio(ratio)}</span>
                  <span className="text-flint"> of {AA_MINIMUM[pair.use]}</span>
                </td>
                <td className="hidden py-2.5 pl-3 align-middle sm:table-cell">{USE_LABEL[pair.use]}</td>
                <td className="hidden py-2.5 pl-3 align-middle text-flint md:table-cell">{pair.where}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <table className="w-full text-sm">
        <caption className="pb-3 text-left text-md font-semibold">Pairs that fail and stay unused</caption>
        <thead>
          <tr className="border-b border-stone text-left text-xs text-flint">
            <th scope="col" className="pb-2 font-semibold">
              Pair
            </th>
            <th scope="col" className="pb-2 pl-3 font-semibold">
              Ratio
            </th>
            <th scope="col" className="hidden pb-2 pl-3 font-semibold sm:table-cell">
              Never used for
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone/30">
          {REJECTED.map((pair) => (
            <tr key={`${pair.foreground}-${pair.background}`}>
              <th scope="row" className="py-2.5 text-left font-normal">
                <span className="block font-semibold">
                  {NAME[pair.foreground]} on {NAME[pair.background]}
                </span>
                <span className="block text-xs text-flint sm:hidden">{pair.reason}</span>
              </th>
              <td className="py-2.5 pl-3 whitespace-nowrap tabular-nums">
                {formatRatio(contrastRatio(COLOR[pair.foreground], COLOR[pair.background]))}
              </td>
              <td className="hidden py-2.5 pl-3 text-flint sm:table-cell">{pair.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TYPE_CLASS: Record<(typeof TYPE_SCALE)[number]["token"], string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
  md: "text-md",
  lg: "text-lg font-semibold",
  xl: "text-xl font-bold",
  "2xl": "text-2xl font-extrabold tracking-tight",
  "3xl": "text-3xl font-extrabold tracking-tight",
  "4xl": "text-4xl font-black tracking-tight",
};

const TYPE_SAMPLE: Record<(typeof TYPE_SCALE)[number]["token"], string> = {
  xs: "Nov 23, 2:31 PM",
  sm: "Agents never accept less than your floor price.",
  base: "The buyer agent reads the room size and hall rules, then searches 24 listings from five sellers.",
  md: "Black balance arm desk lamp",
  lg: "Activity for Jordan Ellis",
  xl: "$52.00 agreed for the white desk",
  "2xl": "Furnish a room for $150",
  "3xl": "One approval pays five sellers",
  "4xl": "Harbor Hall 214",
};

export function TypeScale() {
  return (
    <div className="flex flex-col gap-12">
      <ul className="flex flex-col divide-y divide-stone/30">
        {[...TYPE_SCALE].reverse().map((step) => (
          <li key={step.token} className="grid gap-2 py-4 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-baseline sm:gap-8">
            <span className="text-xs text-flint tabular-nums">
              {step.token}, {step.px} on {step.lineHeight}
            </span>
            <span className={`${TYPE_CLASS[step.token]} text-pretty break-words`}>{TYPE_SAMPLE[step.token]}</span>
          </li>
        ))}
      </ul>
      <div className="grid gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <p className="text-md font-semibold">Weights</p>
          <ul className="flex flex-col gap-1 text-xl">
            <li className="font-normal">400 Help text and body copy</li>
            <li className="font-semibold">600 Labels and card titles</li>
            <li className="font-extrabold">800 Headings</li>
            <li className="font-black">900 Page titles</li>
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <p className="text-md font-semibold">MONO axis, only for codes</p>
          <ul className="flex flex-col gap-2 text-base">
            <li>
              <span className="mono">8RU61172JS455403V</span> <span className="text-sm text-flint">PayPal order ID</span>
            </li>
            <li>
              <span className="mono">capture_items</span> <span className="text-sm text-flint">Agent tool name</span>
            </li>
            <li className="tabular-nums">
              $1,016.00 <span className="text-sm text-flint">Figures are tabular by default, so money aligns in columns</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

const RADIUS_CLASS: Record<(typeof RADIUS_SCALE)[number]["token"], string> = {
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  full: "rounded-full",
};

export function SpaceAndShape() {
  return (
    <div className="grid gap-12 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <p className="text-md font-semibold">Spacing, in steps of {SPACING_UNIT_PX} px</p>
        <ul className="flex flex-col gap-2">
          {SPACING_SCALE.map((step) => (
            <li key={step} className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-4">
              <span className="text-sm tabular-nums">
                {step * SPACING_UNIT_PX} px <span className="text-flint">({step})</span>
              </span>
              <span className="h-2 rounded-[2px] bg-ink" style={{ width: step * SPACING_UNIT_PX }} />
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-md font-semibold">Radius grows with the size of the surface</p>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {RADIUS_SCALE.map((radius) => (
            <li key={radius.token} className="flex flex-col gap-2">
              <span className={`h-16 border-2 border-ink ${RADIUS_CLASS[radius.token]}`} />
              <span className="text-sm">
                <span className="font-semibold">
                  {radius.token}, {radius.token === "full" ? "pill" : `${radius.px} px`}
                </span>
                <span className="block text-flint">{radius.use}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function MotionTokens() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {MOTION.map((motion) => (
        <li key={motion.token} className="flex flex-col gap-1 border-t-2 border-ink pt-3">
          <span className="text-md font-semibold">
            {motion.token} <span className="font-normal text-flint tabular-nums">{motion.ms} ms</span>
          </span>
          <span className="text-sm text-flint">{motion.use}</span>
        </li>
      ))}
    </ul>
  );
}
