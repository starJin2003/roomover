import { ApiError, Client, Environment, type ApiResponse, type OAuthToken } from "@paypal/paypal-server-sdk";
import { readOptionalConfig } from "@/lib/config";
import { readPayPalCredentials, type PayPalCredentials } from "@/lib/paypal/config";
import { payPalApiError } from "@/lib/paypal/errors";
import { appTokens, type AppTokenSource } from "@/lib/paypal/rest/app-token";
import { simulatedAdapter, simulatedSandboxFor } from "@/lib/paypal/simulated-sandbox";

export interface PayPalSdk {
  readonly client: Client;
  readonly tokens: AppTokenSource;
}

const TIMEOUT_MS = 20_000;

// The SDK caches whatever the token provider returns, including a rejected
// promise, and a cached rejection fails every later call on the client. The
// provider therefore never rejects. On failure it hands back an expired token,
// which makes the SDK ask again on the next call.
const EXPIRED_TOKEN: OAuthToken = { accessToken: "", tokenType: "Bearer", expiry: BigInt(0) };

function toSdkToken(refreshAt: number, accessToken: string): OAuthToken {
  // Rounding up keeps the SDK from asking for a new token while the cache still returns the old one.
  return { accessToken, tokenType: "Bearer", expiry: BigInt(Math.ceil(refreshAt / 1000)) };
}

export function createPayPalSdk(options: {
  credentials: PayPalCredentials;
  tokens: AppTokenSource;
  /** Passed to the SDK's axios adapter. Tests use it to stub the transport. */
  transportOverrides?: { adapter: (config: unknown) => Promise<unknown> };
}): PayPalSdk {
  const client = new Client({
    environment: Environment.Sandbox,
    timeout: TIMEOUT_MS,
    clientCredentialsAuthCredentials: {
      oAuthClientId: options.credentials.clientId,
      oAuthClientSecret: options.credentials.clientSecret,
      oAuthTokenProvider: async () => {
        try {
          const token = await options.tokens.get();
          return toSdkToken(token.refreshAt, token.accessToken);
        } catch {
          return EXPIRED_TOKEN;
        }
      },
    },
    httpClientOptions: {
      timeout: TIMEOUT_MS,
      // The runtime's retry loop sees every non-2xx as a thrown error and
      // retries it like a timeout, so a 422 such as AUTHORIZATION_ALREADY_CAPTURED
      // would be sent three times. Callers retry instead, with the same
      // PayPal-Request-Id.
      retryConfig: { maxNumberOfRetries: 0 },
    },
    unstable_httpClientOptions: options.transportOverrides,
  });
  return { client, tokens: options.tokens };
}

/**
 * Runs one SDK operation. The token is fetched first so a token failure
 * surfaces as its own PayPalApiError, and SDK errors are translated so callers
 * handle one error type for SDK and REST calls alike.
 */
export async function callSdk<T>(
  sdk: PayPalSdk,
  operation: string,
  run: () => Promise<ApiResponse<T>>,
): Promise<T> {
  await sdk.tokens.get();
  try {
    return (await run()).result;
  } catch (error) {
    if (error instanceof ApiError) {
      throw payPalApiError({
        operation,
        status: error.statusCode,
        headers: error.headers,
        body: error.result ?? error.body,
      });
    }
    throw error;
  }
}

let processSdk: PayPalSdk | undefined;

/** The process's SDK client. Tests that set ROOMOVER_PAYPAL_FIXTURE get the simulated sandbox. */
export function paypalSdk(): PayPalSdk {
  const simulated = simulatedSandboxFor(readOptionalConfig("ROOMOVER_PAYPAL_FIXTURE"));
  processSdk ??= createPayPalSdk({ credentials: readPayPalCredentials(), tokens: appTokens(), ...(simulated === null ? {} : { transportOverrides: { adapter: simulatedAdapter(simulated) } }) });
  return processSdk;
}
