import Image from "next/image";
import { Spinner } from "@/components/ui/spinner";

/**
 * Where an item stands at handoff. `adjusted` keeps it at a lower price,
 * `released` turns it down or reports it missing, and `failed` marks the
 * item whose last photo got no verdict.
 */
export type HandoffCheck = "matches" | "adjusted" | "released" | "next" | "checking" | "decide" | "failed" | "waiting";

export interface HandoffChecklistItem {
  readonly id: string;
  readonly title: string;
  readonly sellerFirstName: string;
  readonly photo: { readonly src: string };
  readonly check: HandoffCheck;
  /** What was found, for an adjusted, released, or undecided item, such as a new tear and the new price. */
  readonly note?: string;
}

const CHECK_TEXT: Record<HandoffCheck, string> = {
  matches: "matches the listing",
  adjusted: "new damage",
  released: "you pay nothing",
  next: "next",
  checking: "comparing photos",
  decide: "confirm below",
  failed: "photo not compared",
  waiting: "waiting",
};

const ALERT: ReadonlySet<HandoffCheck> = new Set(["adjusted", "released", "failed"]);

interface ItemChecklistProps {
  items: readonly HandoffChecklistItem[];
  /** The item the panel is working on, raised into a well. Defaults to the one marked next. */
  currentId?: string | null;
  /** Lets the student pick another unchecked item to do first. */
  onSelect?: (id: string) => void;
}

/** Every item in the handoff, with the one being checked raised into a well. */
export function ItemChecklist({ items, currentId, onSelect }: ItemChecklistProps) {
  const current = currentId === undefined ? items.find((item) => item.check === "next")?.id : currentId;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const isCurrent = item.id === current;
        const selectable = onSelect !== undefined && !isCurrent && (item.check === "waiting" || item.check === "next" || item.check === "failed" || item.check === "decide");
        const body = (
          <>
            <Image src={item.photo.src} alt="" width={44} height={44} className="size-11 rounded-md object-cover" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{item.title}</span>
              <span className={`flex items-center gap-1.5 text-sm ${ALERT.has(item.check) ? "text-brick" : "text-flint"}`}>
                {item.check === "checking" && <Spinner className="size-3" />}
                <span className="min-w-0">
                  {item.sellerFirstName}, {item.note ?? CHECK_TEXT[item.check]}
                </span>
              </span>
            </span>
          </>
        );
        const row = `grid w-full grid-cols-[44px_minmax(0,1fr)] items-center gap-3 rounded-lg p-2 text-left ${isCurrent ? "bg-well shadow-ring" : ""}`;
        return (
          <li key={item.id} aria-current={isCurrent ? "step" : undefined} data-check={item.check}>
            {selectable ? (
              <button type="button" onClick={() => onSelect(item.id)} className={`${row} transition-colors duration-(--duration-quick) hover:bg-well focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink`}>
                {body}
              </button>
            ) : (
              <div className={row}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
