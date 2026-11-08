import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    alias: {
      "@/": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
