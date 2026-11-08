import { formatUsdShort } from "@/lib/format";
import type { RoomItemData } from "./types";

interface RoomListProps {
  label: string;
  items: readonly RoomItemData[];
  total: number;
  /** The item whose tag stays pinned after a press. */
  selectedKey: string | null;
  onActivate: (key: string | null) => void;
  onToggle: (key: string) => void;
}

/**
 * The room as a list, in the order items were placed. Screen readers and
 * browsers without WebGL get the whole room here, and focusing a row shows
 * the item's tag in the 3D view.
 */
export function RoomList({ label, items, total, selectedKey, onActivate, onToggle }: RoomListProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4 px-2">
        <h3 className="text-sm font-semibold">In {label}</h3>
        <p className="text-sm text-flint tabular-nums">
          {items.length} of {total} items placed
        </p>
      </div>
      {items.length === 0 ? (
        <p className="px-2 text-sm text-flint">The room is empty. Items appear here as they land.</p>
      ) : (
        <ol className="grid gap-x-4 sm:grid-cols-2">
          {items.map((item, index) => (
            <li key={item.layout.key}>
              <button
                type="button"
                data-item={item.layout.key}
                aria-pressed={selectedKey === item.layout.key}
                onFocus={() => onActivate(item.layout.key)}
                onBlur={() => onActivate(null)}
                onMouseEnter={() => onActivate(item.layout.key)}
                onMouseLeave={() => onActivate(null)}
                onClick={() => onToggle(item.layout.key)}
                className="flex min-h-13 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors duration-(--duration-quick) aria-pressed:bg-well hover:bg-well focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                <span className="w-4 shrink-0 text-sm text-flint tabular-nums">{index + 1}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{item.title}</span>
                  <span className="truncate text-xs text-flint">
                    {item.sellerName}, {item.condition.toLowerCase()}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{formatUsdShort(item.priceCents)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
