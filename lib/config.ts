import { z } from "zod";

const configSchema = z.object({
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
  // PayPal webhook IDs are uppercase letters and digits, so a copied placeholder fails here.
  PAYPAL_WEBHOOK_ID: z.string().regex(/^[A-Z0-9]{8,64}$/, "Expected a PayPal webhook ID"),
  ANTHROPIC_API_KEY: z.string().min(1),
  CHANNEL3_API_KEY: z.string().min(1),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  SESSION_SECRET: z.string().min(32),
  APP_URL: z.url({ protocol: /^https?$/ }),
  // Render sets this on every build and deploy. It stays unset locally.
  RENDER_GIT_COMMIT: z.string().regex(/^[0-9a-f]{7,40}$/, "Expected a git commit SHA"),
  // Tests only. The buyer agent replays this recorded Claude conversation and never calls the API.
  ROOMOVER_CLAUDE_FIXTURE: z.string().regex(/\.json$/, "Expected a path to a .json file"),
  // Local development only. Live buyer agent runs write their Claude replies to this file.
  ROOMOVER_CLAUDE_RECORD: z.string().regex(/\.json$/, "Expected a path to a .json file"),
  // Tests only. The verifier agent replays the comparisons recorded in this file, keyed by photo, and never calls the API.
  ROOMOVER_VERIFIER_FIXTURE: z.string().regex(/\.json$/, "Expected a path to a .json file"),
  // Tests only. The sandbox judge buyer's password, which the real checkout test types into the PayPal popup.
  PAYPAL_SANDBOX_BUYER_PASSWORD: z.string().min(1),
  // Live Sell run only. The password of seller 1 (Ava), which the run types into the Log in with PayPal page.
  PAYPAL_SANDBOX_SELLER_PASSWORD: z.string().min(1),
  // Tests only. PayPal calls go to a simulated sandbox built from these recorded responses, so no sandbox money moves.
  ROOMOVER_PAYPAL_FIXTURE: z.string().regex(/\.json$/, "Expected a path to a .json file"),
  // Tests only. The seller agent replays the replies recorded in this file, keyed by photo, and never calls the API.
  ROOMOVER_SELLER_FIXTURE: z.string().regex(/\.json$/, "Expected a path to a .json file"),
  // Tests only. Channel3 image searches replay this file, keyed by photo, and spend no credit.
  ROOMOVER_CHANNEL3_FIXTURE: z.string().regex(/\.json$/, "Expected a path to a .json file"),
  // Tests only. Set to 1 to run the end to end tests against the real sandbox, which moves sandbox money.
  ROOMOVER_E2E_LIVE: z.string().regex(/^1$/, "Expected 1"),
});

export type Config = z.infer<typeof configSchema>;
export type ConfigKey = keyof Config;

type Environment = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {
  readonly variables: readonly ConfigKey[];

  constructor(variables: readonly ConfigKey[], message: string) {
    super(message);
    this.name = "ConfigError";
    this.variables = variables;
  }
}

/**
 * Each feature validates only the keys it names, so a missing key fails the
 * feature that needs it and leaves every other feature running.
 */
export function readConfig<K extends ConfigKey>(
  keys: readonly K[],
  env: Environment = process.env,
): Pick<Config, K> {
  const values: Partial<Config> = {};
  const problems = new Map<ConfigKey, string>();

  for (const key of keys) {
    const raw = env[key];
    if (raw === undefined || raw === "") {
      problems.set(key, `Environment variable ${key} is not set.`);
      continue;
    }
    const result = configSchema.shape[key].safeParse(raw);
    if (result.success) {
      values[key] = result.data;
    } else {
      problems.set(key, `Environment variable ${key} is invalid. ${result.error.issues[0].message}.`);
    }
  }

  if (problems.size > 0) {
    throw new ConfigError([...problems.keys()], [...problems.values()].join(" "));
  }
  return values as Pick<Config, K>;
}

/**
 * For variables a deployment may not have yet. Unset or empty returns
 * undefined, and a value that is set but invalid still throws.
 */
export function readOptionalConfig<K extends ConfigKey>(
  key: K,
  env: Environment = process.env,
): Config[K] | undefined {
  const raw = env[key];
  if (raw === undefined || raw === "") return undefined;
  return readConfig([key], env)[key];
}
