import { z } from "zod";

const configSchema = z.object({
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
  PAYPAL_WEBHOOK_ID: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  CHANNEL3_API_KEY: z.string().min(1),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  SESSION_SECRET: z.string().min(32),
  APP_URL: z.url({ protocol: /^https?$/ }),
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
