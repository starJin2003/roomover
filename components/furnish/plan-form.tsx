"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/field";
import { readPlanPrompt } from "@/lib/domain/plan-request";

export interface PresetChoice {
  slug: string;
  label: string;
  description: string;
}

interface PlanFormProps {
  presets: readonly PresetChoice[];
  presetSlug: string;
  onPresetChange: (slug: string) => void;
  defaultPrompt: string;
  listingCount: number;
  submitting: boolean;
  /** A message from the server about the words, such as a missing budget. */
  promptError: string | null;
  onSubmit: (prompt: string) => void;
}

/** The plan state: which room, and the student's own words with a budget in them. */
export function PlanForm({ presets, presetSlug, onPresetChange, defaultPrompt, listingCount, submitting, promptError, onSubmit }: PlanFormProps) {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [error, setError] = useState<string | null>(null);
  const groupId = useId();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reading = readPlanPrompt(prompt);
    if (!reading.ok) {
      setError(reading.error);
      return;
    }
    setError(null);
    onSubmit(reading.prompt);
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2">
        <legend id={groupId} className="mb-2 text-sm font-medium text-ink">
          Room
        </legend>
        {presets.map((preset) => (
          <label
            key={preset.slug}
            className="flex min-h-13 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 shadow-ring transition-colors duration-(--duration-quick) has-checked:bg-well has-checked:shadow-ring-strong has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink hover:bg-well"
          >
            <input
              type="radio"
              name="preset"
              value={preset.slug}
              checked={preset.slug === presetSlug}
              onChange={() => onPresetChange(preset.slug)}
              className="size-4 shrink-0 accent-ink"
            />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">{preset.label}</span>
              <span className="text-xs text-flint">{preset.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <TextAreaField
        id="furnish-prompt"
        label="What should your room feel like?"
        help={`Include a budget and how you use the room. The agent picks from ${listingCount} listings.`}
        error={error ?? promptError ?? undefined}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        maxLength={280}
        rows={3}
      />
      <Button type="submit" className="w-full" loadingLabel={submitting ? "Starting the buyer agent" : undefined}>
        Plan my room
      </Button>
    </form>
  );
}
