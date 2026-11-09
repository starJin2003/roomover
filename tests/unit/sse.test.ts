import { describe, expect, it } from "vitest";
import { formatSse, formatSseComment, lastEventId } from "@/lib/sse";

describe("server sent event framing", () => {
  it("writes the id, event, retry, and JSON data, then a blank line", () => {
    expect(formatSse({ id: 42, event: "activity", data: { seq: 42, sentence: "Found a desk." }, retry: 2000 })).toBe(
      'id: 42\nevent: activity\nretry: 2000\ndata: {"seq":42,"sentence":"Found a desk."}\n\n',
    );
  });

  it("splits multi line data into one data field per line", () => {
    expect(formatSse({ data: "first\nsecond\r\nthird" })).toBe("data: first\ndata: second\ndata: third\n\n");
  });

  it("keeps line breaks out of the id and event fields", () => {
    expect(formatSse({ id: "4\n2", event: "plan\r\nx", data: 1 })).toBe("id: 4 2\nevent: plan  x\ndata: 1\n\n");
  });

  it("writes comments the browser ignores", () => {
    expect(formatSseComment("ping")).toBe(": ping\n\n");
  });

  it("reads Last-Event-ID only when it is a positive whole number", () => {
    expect(lastEventId(new Headers({ "last-event-id": "17" }))).toBe(17);
    expect(lastEventId(new Headers({ "last-event-id": "abc" }))).toBe(0);
    expect(lastEventId(new Headers({ "last-event-id": "-3" }))).toBe(0);
    expect(lastEventId(new Headers())).toBe(0);
  });
});
