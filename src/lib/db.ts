import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getAppEnv } from "@/lib/env";

type GlobalWithPrisma = typeof globalThis & {
  fleetPrisma?: PrismaClient;
};

export const WRITE_TRANSACTION_OPTIONS = {
  maxWait: 5_000,
  timeout: 10_000,
} as const;

function getDatabaseUrl() {
  return getAppEnv().DATABASE_URL;
}

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: getDatabaseUrl() });
  return new PrismaClient({ adapter });
}

export function getPrisma() {
  const globalForPrisma = globalThis as GlobalWithPrisma;

  if (!globalForPrisma.fleetPrisma) {
    globalForPrisma.fleetPrisma = createPrismaClient();
  }

  return globalForPrisma.fleetPrisma;
}
