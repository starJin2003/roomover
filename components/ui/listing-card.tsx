import Image from "next/image";
import type { ConditionGrade } from "@/lib/domain/listing";
import type { HandoffMode } from "@/lib/domain/enums";
import {
  CONDITION_LABEL,
  conditionScore,
  formatCentimeters,
  formatInches,
  formatUsd,
  HANDOFF_MODE_LABEL,
  type SizeMm,
} from "@/lib/format";

export interface ListingCardData {
  readonly title: string;
  readonly photo: { readonly src: string; readonly alt: string; readonly widthPx: number; readonly heightPx: number };
  readonly grade: ConditionGrade;
  readonly sizeMm: SizeMm;
  readonly priceCents: number;
  readonly newPriceCents: number;
  readonly sellerName: string;
  readonly handoffMode: HandoffMode;
}

function ConditionMeter({ grade }: { grade: ConditionGrade }) {
  const score = conditionScore(grade);
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="flex gap-0.5">
        {[1, 2, 3, 4].map((step) => (
          <span key={step} className={`h-2 w-3.5 rounded-sm ${step <= score ? "bg-ink" : "bg-stone/30"}`} />
        ))}
      </span>
      {CONDITION_LABEL[grade]}
    </span>
  );
}

export function ListingCard({ listing }: { listing: ListingCardData }) {
  return (
    <article className="flex h-full flex-col gap-4 rounded-lg border border-stone/50 p-3 pb-5">
      <Image
        src={listing.photo.src}
        alt={listing.photo.alt}
        width={listing.photo.widthPx}
        height={listing.photo.heightPx}
        sizes="(min-width: 1024px) 340px, (min-width: 640px) 45vw, 100vw"
        className="aspect-[4/3] w-full rounded-md object-cover"
      />
      <div className="flex flex-col gap-3 px-2">
        <h3 className="text-md font-semibold text-pretty">{listing.title}</h3>
        <p className="flex items-baseline justify-between gap-3">
          <span className="text-xl font-bold">{formatUsd(listing.priceCents)}</span>
          <span className="text-sm text-flint">New about {formatUsd(listing.newPriceCents)}</span>
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-flint">Condition</dt>
          <dd>
            <ConditionMeter grade={listing.grade} />
          </dd>
          <dt className="text-flint">Size</dt>
          <dd>
            {formatInches(listing.sizeMm)}
            <span className="block text-flint">{formatCentimeters(listing.sizeMm)}</span>
          </dd>
          <dt className="text-flint">Seller</dt>
          <dd>{listing.sellerName}</dd>
          <dt className="text-flint">Handoff</dt>
          <dd>{HANDOFF_MODE_LABEL[listing.handoffMode]}</dd>
        </dl>
      </div>
    </article>
  );
}
