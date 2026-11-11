/**
 * Strict tool schemas accept no length, range, count, or pattern keywords, so
 * the JSON Schema sent to Claude drops them and zod checks them after the call.
 * Defaults go too, since they only fill in fields that older recordings lack.
 */
const UNSUPPORTED_KEYWORDS = new Set(["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "pattern", "default", "$schema"]);

export function strictSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strictSchema);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => (UNSUPPORTED_KEYWORDS.has(key) ? [] : [[key, strictSchema(entry)]])));
}
