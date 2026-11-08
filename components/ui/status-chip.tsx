import type { StatusDisplay, StatusTone } from "@/lib/design/status";

const TONE: Record<StatusTone, string> = {
  neutral: "border border-stone text-ink",
  held: "border-[1.5px] border-blue text-ink",
  moved: "bg-blue text-ink",
  released: "border border-dashed border-stone text-flint",
  alert: "bg-brick text-paper",
};

export function StatusChip({ status }: { status: StatusDisplay }) {
  return (
    <span
      className={`inline-flex h-7 items-center rounded-full px-3 text-xs font-semibold whitespace-nowrap ${TONE[status.tone]}`}
    >
      {status.label}
    </span>
  );
}
