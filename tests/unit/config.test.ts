import { describe, expect, it } from "vitest";
import { ConfigError, readConfig, readOptionalConfig, type ConfigKey } from "@/lib/config";

const validEnv = {
  PAYPAL_CLIENT_ID: "sandbox-client-id",
  PAYPAL_CLIENT_SECRET: "sandbox-client-secret",
  PAYPAL_WEBHOOK_ID: "8PT597110X687430LKGECATA",
  ANTHROPIC_API_KEY: "test-anthropic-key",
  CHANNEL3_API_KEY: "test-channel3-key",
  DATABASE_URL: "postgresql://roomover:roomover@localhost:5432/roomover",
  SESSION_SECRET: "s".repeat(32),
  APP_URL: "http://localhost:3000",
} satisfies Record<ConfigKey, string>;

const allKeys = Object.keys(validEnv) as ConfigKey[];

function envWithout(key: ConfigKey): Record<string, string> {
  const env: Record<string, string> = { ...validEnv };
  delete env[key];
  return env;
}

function captureConfigError(read: () => unknown): ConfigError {
  try {
    read();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("Expected readConfig to throw a ConfigError.");
}

describe("readConfig", () => {
  it("parses every variable from a complete environment", () => {
    expect(readConfig(allKeys, validEnv)).toEqual(validEnv);
  });

  it("returns only the requested variables", () => {
    expect(readConfig(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"], validEnv)).toEqual({
      PAYPAL_CLIENT_ID: validEnv.PAYPAL_CLIENT_ID,
      PAYPAL_CLIENT_SECRET: validEnv.PAYPAL_CLIENT_SECRET,
    });
  });

  it("reads one feature's variables while other features' variables are unset", () => {
    const env = { ANTHROPIC_API_KEY: validEnv.ANTHROPIC_API_KEY };
    expect(readConfig(["ANTHROPIC_API_KEY"], env)).toEqual(env);
  });

  it("throws an error that names a missing variable", () => {
    const error = captureConfigError(() =>
      readConfig(["PAYPAL_CLIENT_ID", "PAYPAL_WEBHOOK_ID"], envWithout("PAYPAL_WEBHOOK_ID")),
    );
    expect(error.variables).toEqual(["PAYPAL_WEBHOOK_ID"]);
    expect(error.message).toBe("Environment variable PAYPAL_WEBHOOK_ID is not set.");
  });

  it("treats an empty value as missing", () => {
    const error = captureConfigError(() =>
      readConfig(["CHANNEL3_API_KEY"], { ...validEnv, CHANNEL3_API_KEY: "" }),
    );
    expect(error.message).toBe("Environment variable CHANNEL3_API_KEY is not set.");
  });

  it("names every failing variable in one error", () => {
    const error = captureConfigError(() => readConfig(allKeys, {}));
    expect(error.variables).toEqual(allKeys);
  });

  it("names an invalid variable and keeps its value out of the message", () => {
    const shortSecret = "too-short-secret";
    const error = captureConfigError(() =>
      readConfig(["SESSION_SECRET", "APP_URL"], {
        SESSION_SECRET: shortSecret,
        APP_URL: "ftp://files.example.com",
      }),
    );
    expect(error.variables).toEqual(["SESSION_SECRET", "APP_URL"]);
    expect(error.message).toMatch(/SESSION_SECRET is invalid/);
    expect(error.message).toMatch(/APP_URL is invalid/);
    expect(error.message).not.toContain(shortSecret);
  });

  it("rejects a database URL that is not Postgres", () => {
    const error = captureConfigError(() =>
      readConfig(["DATABASE_URL"], { DATABASE_URL: "mysql://localhost:3306/roomover" }),
    );
    expect(error.variables).toEqual(["DATABASE_URL"]);
  });
});

describe("readOptionalConfig", () => {
  it("returns undefined when the variable is unset or empty", () => {
    expect(readOptionalConfig("PAYPAL_WEBHOOK_ID", {})).toBeUndefined();
    expect(readOptionalConfig("PAYPAL_WEBHOOK_ID", { PAYPAL_WEBHOOK_ID: "" })).toBeUndefined();
  });

  it("returns a valid value", () => {
    expect(readOptionalConfig("PAYPAL_WEBHOOK_ID", validEnv)).toBe(validEnv.PAYPAL_WEBHOOK_ID);
  });

  it("throws when the value is set but invalid, such as the .env.example placeholder", () => {
    const error = captureConfigError(() =>
      readOptionalConfig("PAYPAL_WEBHOOK_ID", { PAYPAL_WEBHOOK_ID: "your-sandbox-webhook-id" }),
    );
    expect(error.variables).toEqual(["PAYPAL_WEBHOOK_ID"]);
    expect(error.message).not.toContain("your-sandbox-webhook-id");
  });
});
