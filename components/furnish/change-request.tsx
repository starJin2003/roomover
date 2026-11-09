"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { CHANGE_REQUEST_MAX_LENGTH } from "@/lib/domain/plan-request";

interface ChangeRequestProps {
  /** A request that fits the room, such as "Move the floor lamp to the window". */
  example: string;
  busy: boolean;
  /** Why asking is paused, such as the agent already working. */
  disabledReason: string | null;
  error: string | null;
  onSend: (request: string) => Promise<boolean>;
}

/** A change asked for in words. The agent makes it through the same tools and checks as planning. */
export function ChangeRequest({ example, busy, disabledReason, error, onSend }: ChangeRequestProps) {
  const [request, setRequest] = useState("");
  const [local, setLocal] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = request.trim();
    if (text.length < 3) {
      setLocal(`Say what to change, for example ${example.charAt(0).toLowerCase()}${example.slice(1)}.`);
      return;
    }
    setLocal(null);
    if (await onSend(text)) setRequest("");
  };

  const message = local ?? error;
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      <label htmlFor="change-request" className="text-sm font-medium">
        Ask the agent for a change
      </label>
      <div className="flex gap-2">
        <input
          id="change-request"
          type="text"
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          maxLength={CHANGE_REQUEST_MAX_LENGTH}
          placeholder={example}
          autoComplete="off"
          aria-invalid={message === null ? undefined : true}
          aria-describedby={message === null ? "change-request-help" : "change-request-help change-request-error"}
          disabled={disabledReason !== null}
          className="h-11 min-w-0 flex-1 rounded-lg border border-stone bg-paper px-3 text-base text-ink placeholder:text-flint transition-[border-color] duration-(--duration-quick) key-hover:border-ink key-focus:border-ink key-focus:outline-2 key-focus:outline-offset-2 key-focus:outline-ink aria-invalid:border-brick disabled:cursor-not-allowed disabled:border-stone/50"
        />
        <Button type="submit" variant="secondary" size="sm" loadingLabel={busy ? "Sending" : undefined} disabled={disabledReason !== null}>
          Ask
        </Button>
      </div>
      <p id="change-request-help" className="text-xs text-flint">
        {disabledReason ?? "You can also drag items in the room, or select one and press Turn."}
      </p>
      {message !== null && (
        <p id="change-request-error" className="text-sm font-medium text-brick">
          {message}
        </p>
      )}
    </form>
  );
}
