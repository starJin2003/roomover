import { z } from "zod";

export interface PayPalErrorDetail {
  readonly issue: string;
  readonly description?: string;
  readonly field?: string;
  readonly location?: string;
  readonly value?: string;
}

/**
 * A non-2xx answer from PayPal. `message` is PayPal's own message. `debugId`
 * comes from the paypal-debug-id header, and PayPal support asks for it when
 * tracing a request.
 */
export class PayPalApiError extends Error {
  override readonly name = "PayPalApiError";
  readonly operation: string;
  readonly status: number;
  readonly errorName: string;
  readonly details: readonly PayPalErrorDetail[];
  readonly debugId: string | undefined;

  constructor(init: {
    operation: string;
    status: number;
    errorName: string;
    message: string;
    details: readonly PayPalErrorDetail[];
    debugId: string | undefined;
  }) {
    super(init.message);
    this.operation = init.operation;
    this.status = init.status;
    this.errorName = init.errorName;
    this.details = init.details;
    this.debugId = init.debugId;
  }
}

/** A 2xx answer whose body does not match the schema the caller expects. */
export class PayPalResponseError extends Error {
  override readonly name = "PayPalResponseError";
  readonly operation: string;
  readonly debugId: string | undefined;
  /** JSON paths of the fields that failed, without their values. */
  readonly paths: readonly string[];

  constructor(operation: string, debugId: string | undefined, paths: readonly string[]) {
    super(`${operation} returned a body Roomover cannot read (fields: ${paths.join(", ") || "root"}).`);
    this.operation = operation;
    this.debugId = debugId;
    this.paths = paths;
  }
}

const detailSchema = z.object({
  issue: z.string(),
  description: z.string().optional(),
  field: z.string().optional(),
  location: z.string().optional(),
  value: z.string().optional(),
});

// REST errors use name/message/details. The OAuth endpoints use error/error_description.
const errorBodySchema = z.object({
  name: z.string().optional(),
  message: z.string().optional(),
  debug_id: z.string().optional(),
  details: z.array(detailSchema).optional().catch(undefined),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

type HeaderSource = Headers | Readonly<Record<string, string | undefined>>;

function readHeader(headers: HeaderSource, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name);
  return match === undefined ? undefined : headers[match];
}

export function readDebugId(headers: HeaderSource): string | undefined {
  return readHeader(headers, "paypal-debug-id");
}

function parseBody(body: unknown): z.infer<typeof errorBodySchema> {
  let value = body;
  if (typeof body === "string") {
    try {
      value = JSON.parse(body);
    } catch {
      return {};
    }
  }
  const parsed = errorBodySchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function payPalApiError(init: {
  operation: string;
  status: number;
  headers: HeaderSource;
  body: unknown;
}): PayPalApiError {
  const body = parseBody(init.body);
  return new PayPalApiError({
    operation: init.operation,
    status: init.status,
    errorName: body.name ?? body.error ?? `HTTP_${init.status}`,
    message: body.message ?? body.error_description ?? `PayPal answered ${init.status}.`,
    details: body.details ?? [],
    debugId: readDebugId(init.headers) ?? body.debug_id,
  });
}

export function issuePaths(error: z.ZodError): string[] {
  return error.issues.map((issue) => issue.path.map(String).join(".") || "root");
}
