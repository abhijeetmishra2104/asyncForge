import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors the "@/*" path in tsconfig.json so API route handlers import cleanly.
    alias: { "@": path.resolve(process.cwd()) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Real Postgres and RabbitMQ, started once for the whole run.
    globalSetup: ["tests/helpers/global-setup.ts"],
    setupFiles: ["tests/helpers/setup-env.ts"],
    // Every file shares those two containers, so files must not interleave.
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
    reporters: ["verbose"],
  },
});
