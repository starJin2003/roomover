import { z } from "zod";
import { issuePaths, payPalApiError, PayPalResponseError, readDebugId } from "@/lib/paypal/errors";
import { PAYPAL_SANDBOX, readPayPalCredentials, type PayPalCredentials } from "@/lib/paypal/config";

export interface AppToken {
  readonly accessToken: string;
  /** Epoch milliseconds after which callers should fetch a new token. */
  readonly refreshAt: number;
}

export interface AppTokenSource {
  get(): Promise<AppToken>;
  /** Drops the cached token if it is still the one given, so a stale 401 cannot evict a newer token. */
  invalidate(token: AppToken): void;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const TOKEN_PATH = "/v1/oauth2/token";
const DEFAULT_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().int().positive(),
});

export function basicAuthorization(credentials: PayPalCredentials): string {
  const pair = `${credentials.clientId}:${credentials.clientSecret}`;
  return `Basic ${Buffer.from(pair).toString("base64")}`;
}

/**
 * Client credentials token cache. One token serves every PayPal call in the
 * process and is refreshed a margin before it expires. Concurrent callers
 * share one in-flight request, and a failed request is not cached.
 */
export function createAppTokenSource(options: {
  credentials: PayPalCredentials;
  baseUrl?: string;
  fetch?: FetchLike;
  now?: () => number;
  refreshMarginMs?: number;
  timeoutMs?: number;
}): AppTokenSource {
  const baseUrl = options.baseUrl ?? PAYPAL_SANDBOX.apiBaseUrl;
  const now = options.now ?? Date.now;
  const marginMs = options.refreshMarginMs ?? DEFAULT_REFRESH_MARGIN_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));

  let cached: AppToken | undefined;
  let inFlight: Promise<AppToken> | undefined;

  async function requestToken(): Promise<AppToken> {
    const operation = `POST ${TOKEN_PATH}`;
    const requestedAt = now();
    const response = await doFetch(`${baseUrl}${TOKEN_PATH}`, {
      method: "POST",
      headers: {
        Authorization: basicAuthorization(options.credentials),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) {
      throw payPalApiError({ operation, status: response.status, headers: response.headers, body: text });
    }

    const parsed = tokenResponseSchema.safeParse(safeJson(text));
    if (!parsed.success) {
      throw new PayPalResponseError(operation, readDebugId(response.headers), issuePaths(parsed.error));
    }
    const lifetimeMs = parsed.data.expires_in * 1000;
    // Short lived tokens refresh at half life so the margin never exceeds the lifetime.
    const refreshAfterMs = Math.max(lifetimeMs - marginMs, lifetimeMs / 2);
    return { accessToken: parsed.data.access_token, refreshAt: requestedAt + refreshAfterMs };
  }

  return {
    async get() {
      if (cached !== undefined && now() < cached.refreshAt) return cached;
      inFlight ??= requestToken()
        .then((token) => {
          cached = token;
          return token;
        })
        .finally(() => {
          inFlight = undefined;
        });
      return inFlight;
    },
    invalidate(token) {
      if (cached === token) cached = undefined;
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

let processTokens: AppTokenSource | undefined;

export function appTokens(): AppTokenSource {
  processTokens ??= createAppTokenSource({ credentials: readPayPalCredentials() });
  return processTokens;
}
