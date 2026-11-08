import type { z } from "zod";
import { PAYPAL_SANDBOX, readPayPalCredentials, type PayPalCredentials } from "@/lib/paypal/config";
import { issuePaths, payPalApiError, PayPalResponseError, readDebugId } from "@/lib/paypal/errors";
import {
  appTokens,
  basicAuthorization,
  type AppToken,
  type AppTokenSource,
  type FetchLike,
} from "@/lib/paypal/rest/app-token";

export type RestBody =
  | { readonly kind: "json"; readonly value: unknown }
  /** JSON text sent byte for byte, for payloads that must not be re-serialized. */
  | { readonly kind: "jsonText"; readonly text: string }
  | { readonly kind: "form"; readonly params: URLSearchParams }
  | { readonly kind: "multipart"; readonly form: FormData };

export type RestAuth =
  | { readonly kind: "app" }
  | { readonly kind: "basic" }
  | { readonly kind: "bearer"; readonly token: string };

export interface RestRequest<T> {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: RestBody;
  /** Sent as PayPal-Request-Id. */
  readonly requestId?: string;
  /** Defaults to the cached app token. */
  readonly auth?: RestAuth;
  readonly schema: z.ZodType<T>;
}

export interface PayPalRestClient {
  request<T>(request: RestRequest<T>): Promise<T>;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export function createPayPalRestClient(options: {
  credentials: PayPalCredentials;
  tokens: AppTokenSource;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}): PayPalRestClient {
  const baseUrl = options.baseUrl ?? PAYPAL_SANDBOX.apiBaseUrl;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));

  async function send<T>(request: RestRequest<T>, appToken: AppToken | undefined): Promise<Response> {
    const headers = new Headers({ Accept: "application/json" });
    const auth = request.auth ?? { kind: "app" };
    if (auth.kind === "basic") headers.set("Authorization", basicAuthorization(options.credentials));
    if (auth.kind === "bearer") headers.set("Authorization", `Bearer ${auth.token}`);
    if (appToken !== undefined) headers.set("Authorization", `Bearer ${appToken.accessToken}`);
    if (request.requestId !== undefined) headers.set("PayPal-Request-Id", request.requestId);

    let body: BodyInit | undefined;
    switch (request.body?.kind) {
      case "json":
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(request.body.value);
        break;
      case "jsonText":
        headers.set("Content-Type", "application/json");
        body = request.body.text;
        break;
      case "form":
        headers.set("Content-Type", "application/x-www-form-urlencoded");
        body = request.body.params;
        break;
      case "multipart":
        // fetch writes the multipart boundary into Content-Type itself.
        body = request.body.form;
        break;
    }

    return doFetch(buildUrl(baseUrl, request), {
      method: request.method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  return {
    async request<T>(request: RestRequest<T>): Promise<T> {
      const operation = `${request.method} ${request.path}`;
      const usesAppToken = (request.auth ?? { kind: "app" }).kind === "app";

      let appToken = usesAppToken ? await options.tokens.get() : undefined;
      let response = await send(request, appToken);
      if (response.status === 401 && appToken !== undefined) {
        // PayPal can revoke a token before its expiry. Fetch a fresh one and try once more.
        options.tokens.invalidate(appToken);
        appToken = await options.tokens.get();
        response = await send(request, appToken);
      }

      const text = await response.text();
      if (!response.ok) {
        throw payPalApiError({ operation, status: response.status, headers: response.headers, body: text });
      }

      const parsed = request.schema.safeParse(text === "" ? undefined : parseJson(text));
      if (!parsed.success) {
        throw new PayPalResponseError(operation, readDebugId(response.headers), issuePaths(parsed.error));
      }
      return parsed.data;
    },
  };
}

function buildUrl(baseUrl: string, request: RestRequest<unknown>): string {
  const url = new URL(request.path, baseUrl);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

let processClient: PayPalRestClient | undefined;

export function paypalRest(): PayPalRestClient {
  processClient ??= createPayPalRestClient({ credentials: readPayPalCredentials(), tokens: appTokens() });
  return processClient;
}
