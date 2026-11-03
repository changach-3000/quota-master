import path from "node:path";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` throws outside React Server Components; services are plain server code in tests.
      "server-only": path.resolve(__dirname, "tests/stubs/empty.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/db/global-setup.ts"],
    // Services under test must hit the test database, never the dev one.
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "" },
    // DB tests share one test database; run files one at a time.
    fileParallelism: false,
  },
});
