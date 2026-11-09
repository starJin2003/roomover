import Image from "next/image";
import { Spinner } from "@/components/ui/spinner";
import type { HandoffItemView } from "@/lib/handoff/view";

interface CurrentItemProps {
  item: HandoffItemView;
  index: number;
  total: number;
  /** A photo the student just chose, shown while it uploads. */
  preview: string | null;
  /** Takes the photo again, offered once a photo has a verdict or failed. */
  onRetake?: () => void;
}

function PhotoTile({ src, label, alt, busy = false }: { src: string; label: string; alt: string; busy?: boolean }) {
  return (
    <figure className="relative overflow-hidden rounded-lg bg-well">
      <Image src={src} alt={alt} width={640} height={480} unoptimized={src.startsWith("/api/") || src.startsWith("blob:")} className="aspect-[4/3] w-full object-cover" />
      <figcaption className="absolute bottom-2 left-2 rounded-md bg-paper px-2 py-1 text-xs font-medium shadow-ring">{label}</figcaption>
      {busy && (
        <div role="status" className="absolute inset-0 grid place-items-center bg-ink/40">
          <span className="flex items-center gap-2 rounded-md bg-paper px-3 py-2 text-sm font-medium">
            <Spinner className="size-3.5" />
            Comparing
          </span>
        </div>
      )}
    </figure>
  );
}

/**
 * The item being checked. Before a photo it shows the seller's photo as the
 * angle to match. After one, the student's photo fills the card with the
 * seller's in its corner, and the verifier's finding follows.
 */
export function CurrentItem({ item, index, total, preview, onRetake }: CurrentItemProps) {
  const photo = preview ?? item.photo?.src ?? null;
  const sellers = `${item.sellerFirstName}'s photo`;
  const checking = item.state === "checking" || preview !== null;
  const alert = item.verdict !== null && item.verdict.verdict !== "match";
  return (
    <article aria-labelledby="current-item-title" data-current-item={item.orderItemId} data-state={checking ? "checking" : item.state} className="flex flex-col gap-3 rounded-xl bg-paper p-3 shadow-ring">
      {photo === null ? (
        <PhotoTile src={item.listingPhoto.src} label={sellers} alt={item.listingPhoto.alt} />
      ) : (
        <div className="relative">
          <PhotoTile src={photo} label="Your photo" alt={`Your handoff photo of the ${item.noun}`} busy={checking} />
          <figure className="absolute top-2 right-2 w-[40%] overflow-hidden rounded-md bg-well shadow-sheet ring-2 ring-paper">
            <Image src={item.listingPhoto.src} alt={item.listingPhoto.alt} width={240} height={180} className="aspect-[4/3] w-full object-cover" />
            <figcaption className="absolute bottom-1 left-1 rounded-sm bg-paper px-1.5 py-0.5 text-xs font-medium whitespace-nowrap">{sellers}</figcaption>
          </figure>
          {onRetake !== undefined && !checking && (
            <button
              type="button"
              onClick={onRetake}
              className="absolute right-2 bottom-2 h-9 rounded-md bg-paper px-3 text-sm font-medium shadow-ring transition-colors duration-(--duration-quick) hover:bg-well focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              Retake
            </button>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1 px-1 pb-1">
        <h2 id="current-item-title" className="text-base font-semibold">
          {item.title}
        </h2>
        <p className="text-sm text-flint">
          {photo === null ? `${sellers}. Match this angle, item ${index + 1} of ${total}.` : `Item ${index + 1} of ${total}, from ${item.sellerName}.`}
        </p>
      </div>
      {!checking && item.finding !== null && (
        <p data-finding className={`px-1 pb-1 text-base ${alert ? "font-medium text-brick" : ""}`}>
          {item.finding}
        </p>
      )}
      {!checking && item.state === "failed" && item.verifierError !== null && <p className="px-1 pb-1 text-sm font-medium text-brick">{item.verifierError}</p>}
    </article>
  );
}
