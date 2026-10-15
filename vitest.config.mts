import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      RG_DB_PATH: ":memory:",
      MODEL_API_KEY: "test-muse",
      HEYREACH_API_KEY: "test-heyreach",
      HEYREACH_WEBHOOK_TOKEN: "test-token",
      RG_JOBS_ENABLED: "0",
      RG_LIVE_ENABLED: "1",
    },
  },
});
