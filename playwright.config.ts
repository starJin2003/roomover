import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Tests sign their own tagged sessions and clean the shared database, so they read the same local settings as the server.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const port = 3100;
const baseURL = `http://localhost:${port}`;
const isCI = Boolean(process.env.CI);
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
    // Always a fresh server with the recorded Claude conversations, so tests never reach the API.
    reuseExistingServer: false,
    env: { ROOMOVER_CLAUDE_FIXTURE: "tests/fixtures/buyer-agent.json", ROOMOVER_VERIFIER_FIXTURE: "tests/fixtures/verifier-agent.json" },
    timeout: 180_000,
  },
});
