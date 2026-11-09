"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { CameraIcon } from "@/components/ui/icons";
import type { HandoffChoice } from "@/lib/domain/money-policy";
import { formatUsdShort } from "@/lib/format";
import type { SampleKind } from "@/lib/handoff/samples";
import type { ChoiceView, HandoffItemView } from "@/lib/handoff/view";

interface ItemActionsProps {
  item: HandoffItemView;
  /** A request for this item is under way, which stops further presses. */
  busy: boolean;
  onPhoto: (file: File) => void;
  onSample: (kind: SampleKind) => void;
  onRetry: () => void;
  onChoose: (choice: HandoffChoice) => void;
}

/** What each choice says on its key, with the amount code worked out. */
function choiceLabel(item: HandoffItemView, choice: ChoiceView): string {
  switch (choice.choice) {
    case "accept":
      return item.verdict?.verdict === "wrong_item" ? `Keep it anyway, pay ${formatUsdShort(choice.payCents)}` : `Confirm, pay ${formatUsdShort(choice.payCents)}`;
    case "keep_half":
      return `Keep it for ${formatUsdShort(choice.payCents)}`;
    case "turn_down":
      return "Turn it down";
    case "not_here":
      return "It was not there";
  }
}

const SAMPLE_LABEL: Record<SampleKind, string> = { as_listed: "Use a sample photo", torn: "Sample with a new tear" };

/**
 * The one action for the item in front of the student. Before a verdict it
 * takes a photo, from the camera on a phone or a file on a computer. After
 * one it offers the choices the money policy allows, and one tap confirms.
 */
export function ItemActions({ item, busy, onPhoto, onSample, onRetry, onChoose }: ItemActionsProps) {
  const input = useRef<HTMLInputElement>(null);
  const take = () => input.current?.click();
  const fileInput = (
    <input
      ref={input}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      capture="environment"
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file !== undefined) onPhoto(file);
      }}
    />
  );

  if (item.state === "checking" || (busy && item.state !== "decide")) {
    return (
      <div className="flex flex-col gap-2">
        <Button className="w-full" loadingLabel={`Comparing with ${item.sellerFirstName}'s photos`} />
      </div>
    );
  }

  if (item.state === "decide") {
    const [first, second] = item.choices;
    return (
      <div className="flex flex-col gap-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          {first !== undefined && (
            <Button className="w-full" disabled={busy} onClick={() => onChoose(first.choice)}>
              {choiceLabel(item, first)}
            </Button>
          )}
          {second !== undefined && (
            <Button variant="secondary" disabled={busy} onClick={() => onChoose(second.choice)}>
              {choiceLabel(item, second)}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {fileInput}
      <div className={item.state === "failed" && item.photo !== null ? "grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" : "flex"}>
        <Button className="w-full" disabled={busy} onClick={take}>
          <CameraIcon className="size-5" />
          <span className="lg:hidden">{item.state === "failed" ? "Take a new photo" : "Take a photo"}</span>
          <span className="max-lg:hidden">{item.state === "failed" ? `Take a new photo of the ${item.noun}` : `Add a photo of the ${item.noun}`}</span>
        </Button>
        {item.state === "failed" && item.photo !== null && (
          <Button variant="secondary" disabled={busy} onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-x-1 gap-y-1">
        {item.samples.map((sample) => (
          <Button key={sample.kind} variant="quiet" size="sm" disabled={busy} onClick={() => onSample(sample.kind)}>
            {SAMPLE_LABEL[sample.kind]}
          </Button>
        ))}
        <Button variant="quiet" size="sm" disabled={busy} onClick={() => onChoose("not_here")}>
          {item.sellerFirstName} did not bring it
        </Button>
      </div>
    </div>
  );
}
