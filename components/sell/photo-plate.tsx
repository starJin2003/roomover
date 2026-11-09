import type { ReactNode } from "react";
import { CameraIcon } from "@/components/ui/icons";

interface PhotoPlateProps {
  photo: { src: string; alt: string } | null;
  /** The words in the empty frame before there is a photo. */
  emptyText: string;
  /** Opens the camera or the file picker from the empty frame. Absent before the seller signs in. */
  onPick?: () => void;
  /** Items like the seller's, shown small in the empty frame before Log in with PayPal. */
  preview?: readonly { src: string; label: string }[];
  /** Sits under the plate, such as Use a different photo. */
  children?: ReactNode;
}

/**
 * The seller's photo on a Paper plate, where the room stands on the other
 * screens. On desktop the plate takes the column's height, and the photo
 * keeps its proportions inside it.
 */
export function PhotoPlate({ photo, emptyText, onPick, preview = [], children }: PhotoPlateProps) {
  const frame = "flex size-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-stone p-6 text-center text-sm text-flint";
  return (
    <div className="flex flex-col items-center gap-4 lg:h-full lg:min-h-0">
      <div data-photo-plate className="flex aspect-[4/5] max-h-[62vh] w-full items-center justify-center rounded-2xl bg-paper p-3 shadow-sheet sm:aspect-[4/3] lg:aspect-auto lg:max-h-none lg:min-h-0 lg:max-w-[640px] lg:flex-1 lg:p-4">
        {photo !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- uploads are served by an API route, so next/image cannot size them ahead of time.
          <img src={photo.src} alt={photo.alt} className="max-h-full max-w-full rounded-lg object-contain" />
        ) : onPick !== undefined ? (
          <button type="button" onClick={onPick} className={`${frame} cursor-pointer transition-colors duration-(--duration-quick) hover:bg-well key-focus:outline-2 key-focus:outline-offset-2 key-focus:outline-ink`}>
            <CameraIcon className="size-8 text-ink" />
            <span>{emptyText}</span>
          </button>
        ) : (
          <div className={`${frame} gap-6`}>
            <span className="flex flex-col items-center gap-3">
              <CameraIcon className="size-8" />
              <span>{emptyText}</span>
            </span>
            {preview.length > 0 && (
              <ul aria-label="Items students list" className="grid w-full max-w-sm grid-cols-3 gap-3">
                {preview.map((item) => (
                  <li key={item.src} className="flex flex-col gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- small committed thumbnails, sized by the grid. */}
                    <img src={item.src} alt="" className="aspect-square w-full rounded-md object-cover" />
                    <span className="text-xs">{item.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
