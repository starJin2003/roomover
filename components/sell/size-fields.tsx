import { TextField } from "@/components/ui/field";

export interface SizeText {
  width: string;
  depth: string;
  height: string;
}

const MM_PER_INCH = 25.4;

/** A size in millimeters as the half inches the fields show, such as a similar item's size the seller checks. */
export function sizeTextFromMm([width, depth, height]: readonly [number, number, number]): SizeText {
  const inches = (mm: number) => String(Math.round((mm / MM_PER_INCH) * 2) / 2);
  return { width: inches(width), depth: inches(depth), height: inches(height) };
}

/** Millimeters from what the seller typed in inches, or null until all three read as sizes. */
export function sizeFromInches(text: SizeText): { widthMm: number; depthMm: number; heightMm: number } | null {
  const values = [text.width, text.depth, text.height].map((value) => Number(value.trim()));
  if (values.some((value) => !Number.isFinite(value) || value <= 0 || value > 160)) return null;
  const [widthMm, depthMm, heightMm] = values.map((value) => Math.round(value * MM_PER_INCH));
  return { widthMm, depthMm, heightMm };
}

/** Width, depth, and height in inches, for an item Channel3 could not size. A note says where prefilled values came from. */
export function SizeFields({ value, onChange, error, note }: { value: SizeText; onChange: (next: SizeText) => void; error?: string; note?: string }) {
  const described = [note === undefined ? undefined : "size-note", error === undefined ? undefined : "size-error"].filter(Boolean).join(" ") || undefined;
  const field = (key: keyof SizeText, label: string) => (
    <TextField
      id={`size-${key}`}
      label={label}
      inputMode="decimal"
      autoComplete="off"
      value={value[key]}
      onChange={(event) => onChange({ ...value, [key]: event.target.value })}
      aria-invalid={error === undefined ? undefined : true}
      aria-describedby={described}
    />
  );
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium text-ink">Size in inches</legend>
      {note !== undefined && (
        <p id="size-note" className="-mt-1 mb-1 text-sm text-flint">
          {note}
        </p>
      )}
      <div className="grid grid-cols-3 gap-3">
        {field("width", "Width")}
        {field("depth", "Depth")}
        {field("height", "Height")}
      </div>
      {error !== undefined && (
        <p id="size-error" className="text-sm font-medium text-brick">
          {error}
        </p>
      )}
    </fieldset>
  );
}
