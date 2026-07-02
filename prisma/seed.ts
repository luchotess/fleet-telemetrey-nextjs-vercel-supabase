import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedReferenceData } from "../src/lib/domain/seed";

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

async function main() {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DIRECT_URL or DATABASE_URL is required to seed data.");
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    await seedReferenceData(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
