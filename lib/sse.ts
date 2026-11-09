/**
 * Server sent event framing (https://html.spec.whatwg.org/multipage/server-sent-events.html).
 * A message is its fields, one per line, and a blank line ends it.
 */

export interface SseMessage {
  id?: number | string;
  event?: string;
  data: unknown;
  /** Milliseconds the browser waits before reconnecting. */
  retry?: number;
}

const clean = (value: string) => value.replace(/[\r\n]/g, " ");

export function formatSse({ id, event, data, retry }: SseMessage): string {
  const lines: string[] = [];
  if (id !== undefined) lines.push(`id: ${clean(String(id))}`);
  if (event !== undefined) lines.push(`event: ${clean(event)}`);
  if (retry !== undefined) lines.push(`retry: ${Math.max(0, Math.round(retry))}`);
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  for (const line of payload.split(/\r\n|\r|\n/)) lines.push(`data: ${line}`);
  return `${lines.join("\n")}\n\n`;
}

/** A comment line, which keeps the connection open through proxies and is ignored by the browser. */
export function formatSseComment(text: string): string {
  return `: ${clean(text)}\n\n`;
}

/** The last event ID the browser saw, from the Last-Event-ID header on reconnect. */
export function lastEventId(headers: Headers): number {
  const value = Number(headers.get("last-event-id"));
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}
