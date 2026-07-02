import { afterEach, describe, expect, it, vi } from "vitest";
import { getAppEnv, resetAppEnvForTests } from "@/lib/env";

const originalEnv = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, originalEnv);
  vi.unstubAllEnvs();
  resetAppEnvForTests();
}

describe("runtime environment", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("parses local demo settings", () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.DATABASE_URL =
      "postgresql://fleet:fleet@localhost:5434/fleet?schema=public";
    process.env.JWT_SECRET = "development-only-secret";
    delete process.env.STALE_AFTER_SECONDS;

    expect(getAppEnv()).toMatchObject({
      JWT_ALGORITHM: "HS256",
      STALE_AFTER_SECONDS: 10,
      SIMULATOR_TICK_RATE_LIMIT_REQUESTS: 120,
      SIMULATOR_TICK_RATE_LIMIT_WINDOW_SECONDS: 60,
    });
  });

  it("rejects missing required database configuration", () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.DATABASE_URL;
    delete process.env.DIRECT_URL;
    process.env.JWT_SECRET = "development-only-secret";

    expect(() => getAppEnv()).toThrow(/DATABASE_URL/);
  });

  it("rejects weak production JWT secrets", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.DATABASE_URL =
      "postgresql://fleet:fleet@localhost:5434/fleet?schema=public";
    process.env.JWT_SECRET = "development-only-secret";

    expect(() => getAppEnv()).toThrow(/JWT_SECRET/);
  });
});
