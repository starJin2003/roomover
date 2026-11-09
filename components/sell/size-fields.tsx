import { TextField } from "@/components/ui/field";

export interface SizeText {
  width: string;
  depth: string;
  height: string;
}

const MM_PER_INCH = 25.4;

/** Millimeters from what the seller typed in inches, or null until all three read as sizes. */
export function sizeFromInches(text: SizeText): { widthMm: number; depthMm: number; heightMm: number } | null {
  const values = [text.width, text.depth, text.height].map((value) => Number(value.trim()));
  if (values.some((value) => !Number.isFinite(value) || value <= 0 || value > 160)) return null;
  const [widthMm, depthMm, heightMm] = values.map((value) => Math.round(value * MM_PER_INCH));
  return { widthMm, depthMm, heightMm };
}

/** Width, depth, and height in inches, for an item Channel3 could not size. */
export function SizeFields({ value, onChange, error }: { value: SizeText; onChange: (next: SizeText) => void; error?: string }) {
  const field = (key: keyof SizeText, label: string) => (
    <TextField
      id={`size-${key}`}
      label={label}
      inputMode="decimal"
      autoComplete="off"
      value={value[key]}
      onChange={(event) => onChange({ ...value, [key]: event.target.value })}
      aria-invalid={error === undefined ? undefined : true}
      aria-describedby={error === undefined ? undefined : "size-error"}
    />
  );
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium text-ink">Size in inches</legend>
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
