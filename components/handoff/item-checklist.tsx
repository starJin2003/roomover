import Image from "next/image";

export type HandoffCheck = "matches" | "adjusted" | "next" | "waiting";

export interface HandoffChecklistItem {
  readonly id: string;
  readonly title: string;
  readonly sellerFirstName: string;
  readonly photo: { readonly src: string };
  readonly check: HandoffCheck;
  /** What the verifier found, for an adjusted item, such as a new tear and the new price. */
  readonly finding?: string;
}

const CHECK_TEXT: Record<Exclude<HandoffCheck, "adjusted">, string> = {
  matches: "matches the listing",
  next: "next",
  waiting: "waiting",
};

/** Every item in the handoff, with the next one to photograph raised into a well. */
export function ItemChecklist({ items }: { items: readonly HandoffChecklistItem[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li
          key={item.id}
          aria-current={item.check === "next" ? "step" : undefined}
          className={`grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3 rounded-lg p-2 ${item.check === "next" ? "bg-well shadow-ring" : ""}`}
        >
          <Image src={item.photo.src} alt="" width={44} height={44} className="size-11 rounded-md object-cover" />
          <span className="flex flex-col">
            <span className="text-sm font-medium">{item.title}</span>
            <span className={`text-sm ${item.check === "adjusted" ? "text-brick" : "text-flint"}`}>
              {item.sellerFirstName}, {item.check === "adjusted" ? item.finding : CHECK_TEXT[item.check]}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
