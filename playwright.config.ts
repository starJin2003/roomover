import { defineConfig } from "@playwright/test";

const port = 3100;
const baseURL = `http://localhost:${port}`;
const isCI = Boolean(process.env.CI);
// The 3D room draws on the GPU. Without these flags, headless Chromium falls back to software WebGL.
const gpuArgs = process.platform === "darwin" ? ["--use-angle=metal", "--ignore-gpu-blocklist"] : ["--ignore-gpu-blocklist"];

export default defineConfig({
  testDir: "tests/e2e",
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
    reuseExistingServer: !isCI,
    timeout: 180_000,
  },
});
