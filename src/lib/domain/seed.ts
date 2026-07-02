import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ZONES } from "@/lib/constants";

type SeedClient = PrismaClient | Prisma.TransactionClient;

export async function seedReferenceData(prisma: SeedClient) {
  for (let i = 1; i <= 50; i += 1) {
    await prisma.vehicle.upsert({
      where: { vehicleId: `v-${i}` },
      update: {},
      create: { vehicleId: `v-${i}`, status: "idle" },
    });
  }

  for (const zoneId of ZONES) {
    await prisma.zoneCount.upsert({
      where: { zoneId },
      update: {},
      create: { zoneId, entryCount: BigInt(0) },
    });
  }
}
