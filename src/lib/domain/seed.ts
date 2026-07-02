import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ZONES } from "@/lib/constants";

type SeedClient = PrismaClient | Prisma.TransactionClient;

export async function seedReferenceData(prisma: SeedClient) {
  await prisma.vehicle.createMany({
    data: Array.from({ length: 50 }, (_, index) => ({
      vehicleId: `v-${index + 1}`,
      status: "idle" as const,
    })),
    skipDuplicates: true,
  });

  await prisma.zoneCount.createMany({
    data: ZONES.map((zoneId) => ({
      zoneId,
      entryCount: BigInt(0),
    })),
    skipDuplicates: true,
  });
}
