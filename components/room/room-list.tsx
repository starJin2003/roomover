import type { KeyboardEvent } from "react";
import { formatUsdShort } from "@/lib/format";
import type { RoomItemData } from "./types";

interface ListEditing {
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, key: string) => void;
  onBlur: () => void;
  /** The item whose current spot fails the fit check. */
  invalidKey: string | null;
}

interface RoomListProps {
  label: string;
  items: readonly RoomItemData[];
  total: number;
  /** The item whose tag stays pinned after a press. */
  selectedKey: string | null;
  onActivate: (key: string | null) => void;
  onToggle: (key: string) => void;
  /** Rows move and turn their item from the keyboard. */
  editing?: ListEditing;
}

/**
 * The room as a list, in the order items were placed. Screen readers and
 * browsers without WebGL get the whole room here, and focusing a row shows
 * the item's tag in the 3D view.
 */
export function RoomList({ label, items, total, selectedKey, onActivate, onToggle, editing }: RoomListProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4 px-2">
        <h3 className="text-sm font-semibold">In {label}</h3>
        <p className="text-sm text-flint tabular-nums">
          {items.length} of {total} items placed
        </p>
      </div>
      {editing !== undefined && items.length > 0 && (
        <p id="room-list-keys" className="px-2 text-xs text-flint">
          Focus an item, then use the arrow keys to move it and R to turn it. Escape puts it back.
        </p>
      )}
      {items.length === 0 ? (
        <p className="px-2 text-sm text-flint">The room is empty. Items appear here as they land.</p>
      ) : (
        <ol className="grid gap-x-4 sm:grid-cols-2">
          {items.map((item, index) => (
            <li key={item.layout.key} className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                data-item={item.layout.key}
                data-new-item={item.newFrom === undefined ? undefined : true}
                aria-pressed={selectedKey === item.layout.key}
                aria-describedby={editing === undefined ? undefined : "room-list-keys"}
                data-invalid={editing?.invalidKey === item.layout.key || undefined}
                onFocus={() => onActivate(item.layout.key)}
                onBlur={() => {
                  onActivate(null);
                  editing?.onBlur();
                }}
                onKeyDown={editing === undefined ? undefined : (event) => editing.onKeyDown(event, item.layout.key)}
                onMouseEnter={() => onActivate(item.layout.key)}
                onMouseLeave={() => onActivate(null)}
                onClick={() => onToggle(item.layout.key)}
                className="flex min-h-13 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors duration-(--duration-quick) aria-pressed:bg-well hover:bg-well focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink data-invalid:shadow-[inset_0_0_0_1.5px_var(--color-brick)]"
              >
                <span className="w-4 shrink-0 text-sm text-flint tabular-nums">{index + 1}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{item.title}</span>
                  <span className="truncate text-xs text-flint">
                    {item.newFrom === undefined ? `${item.sellerName}, ${item.condition.toLowerCase()}${item.slotLabel === undefined ? "" : `, ${item.slotLabel}`}` : item.condition}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end tabular-nums">
                  <span className="text-sm font-semibold">{formatUsdShort(item.priceCents)}</span>
                  {item.listPriceCents !== undefined && (
                    <span className="text-xs text-flint">
                      <span className="sr-only">asking price </span>
                      <s>{formatUsdShort(item.listPriceCents)}</s>
                    </span>
                  )}
                </span>
              </button>
              {item.newFrom !== undefined && (
                <a
                  href={item.newFrom.buyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-medium underline decoration-stone underline-offset-4 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  Buy<span className="sr-only"> the {item.title} at {item.newFrom.retailer}, opens in a new tab</span>
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
