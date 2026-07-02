import type { Prisma } from "@/generated/prisma/client";
import {
  RATE_LIMIT_REQUESTS,
  RATE_LIMIT_WINDOW_SECONDS,
} from "@/lib/constants";
import { AppError } from "@/lib/errors";

export async function enforceTelemetryRateLimit(
  tx: Prisma.TransactionClient,
  vehicleId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${vehicleId}))`;

  const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000);
  await tx.telemetryRateLimitHit.deleteMany({
    where: {
      vehicleId,
      occurredAt: { lte: cutoff },
    },
  });

  const recentHits = await tx.telemetryRateLimitHit.count({
    where: {
      vehicleId,
      occurredAt: { gt: cutoff },
    },
  });

  if (recentHits >= RATE_LIMIT_REQUESTS) {
    throw new AppError(429, "Telemetry rate limit exceeded");
  }

  await tx.telemetryRateLimitHit.create({
    data: { vehicleId },
  });
}

export async function enforceApiRateLimit(
  tx: Prisma.TransactionClient,
  input: {
    scope: string;
    identifier: string;
    limit: number;
    windowSeconds: number;
    message?: string;
  },
) {
  const lockKey = `${input.scope}:${input.identifier}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

  const cutoff = new Date(Date.now() - input.windowSeconds * 1000);
  await tx.apiRateLimitHit.deleteMany({
    where: {
      scope: input.scope,
      identifier: input.identifier,
      occurredAt: { lte: cutoff },
    },
  });

  const recentHits = await tx.apiRateLimitHit.count({
    where: {
      scope: input.scope,
      identifier: input.identifier,
      occurredAt: { gt: cutoff },
    },
  });

  if (recentHits >= input.limit) {
    throw new AppError(429, input.message ?? "Rate limit exceeded");
  }

  await tx.apiRateLimitHit.create({
    data: {
      scope: input.scope,
      identifier: input.identifier,
    },
  });
}
