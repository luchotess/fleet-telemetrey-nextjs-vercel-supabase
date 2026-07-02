import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3210";
const defaultDatabaseUrl =
  "postgresql://fleet:fleet@localhost:5434/fleet?schema=public";
const e2eJwtSecret =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
    ? process.env.JWT_SECRET
    : "e2e-local-secret-that-is-long-enough-for-production-runtime";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command:
          "npm run build && npm run start -- --hostname 127.0.0.1 --port 3210",
        env: {
          DATABASE_URL: process.env.DATABASE_URL ?? defaultDatabaseUrl,
          DIRECT_URL:
            process.env.DIRECT_URL ??
            process.env.DATABASE_URL ??
            defaultDatabaseUrl,
          JWT_SECRET: e2eJwtSecret,
          JWT_ALGORITHM: process.env.JWT_ALGORITHM ?? "HS256",
          STALE_AFTER_SECONDS: process.env.STALE_AFTER_SECONDS ?? "10",
          SIMULATOR_TICK_RATE_LIMIT_REQUESTS:
            process.env.SIMULATOR_TICK_RATE_LIMIT_REQUESTS ?? "120",
          SIMULATOR_TICK_RATE_LIMIT_WINDOW_SECONDS:
            process.env.SIMULATOR_TICK_RATE_LIMIT_WINDOW_SECONDS ?? "60",
        },
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
