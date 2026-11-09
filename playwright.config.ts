import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import { readOptionalConfig } from "./lib/config";

// Tests sign their own tagged sessions and clean the shared database, so they read the same local settings as the server.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const port = 3100;
const baseURL = `http://localhost:${port}`;
const isCI = Boolean(process.env.CI);
// Checkout and handoff move real sandbox money only on request. Otherwise PayPal answers from recorded responses.
const live = readOptionalConfig("ROOMOVER_E2E_LIVE") !== undefined;
const PAYPAL_FIXTURE = "tests/fixtures/paypal-sandbox.json";
// The test process tears down what each session paid for, so it talks to the same recorded sandbox as the server.
if (!live) process.env.ROOMOVER_PAYPAL_FIXTURE = PAYPAL_FIXTURE;
// The 3D room draws on the GPU. Without these flags, headless Chromium falls back to software WebGL.
const gpuArgs = process.platform === "darwin" ? ["--use-angle=metal", "--ignore-gpu-blocklist"] : ["--ignore-gpu-blocklist"];

export default defineConfig({
  testDir: "tests/e2e",
  globalTeardown: "./tests/e2e/support/teardown.ts",
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? "github" : "list",
  use: {
    baseURL,
    browserName: "chromium",
    trace: "on-first-retry",
    launchOptions: { args: gpuArgs },
  },
  projects: [
    {
      name: "desktop-1440",
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-390",
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm start --port ${port}`,
    url: baseURL,
    // Always a fresh server with the recorded Claude and Channel3 answers, so tests never reach those APIs.
    reuseExistingServer: false,
    env: {
      APP_URL: baseURL,
      ROOMOVER_CLAUDE_FIXTURE: "tests/fixtures/buyer-agent.json",
      ROOMOVER_VERIFIER_FIXTURE: "tests/fixtures/verifier-agent.json",
      ROOMOVER_SELLER_FIXTURE: "tests/fixtures/seller-agent.json",
      ROOMOVER_CHANNEL3_FIXTURE: "tests/fixtures/channel3.json",
      ...(live ? {} : { ROOMOVER_PAYPAL_FIXTURE: PAYPAL_FIXTURE }),
    },
    timeout: 180_000,
  },
});
