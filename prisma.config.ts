import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

const explicitEnv = new Map(
  [
    "DATABASE_URL",
    "DIRECT_URL",
    "JWT_SECRET",
    "JWT_ALGORITHM",
    "STALE_AFTER_SECONDS",
  ].map((key) => [key, process.env[key]]),
);

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

for (const [key, value] of explicitEnv) {
  if (value !== undefined) {
    process.env[key] = value;
  }
}

const datasourceUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!datasourceUrl) {
  throw new Error("DIRECT_URL or DATABASE_URL is required for Prisma commands.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: datasourceUrl,
  },
});
