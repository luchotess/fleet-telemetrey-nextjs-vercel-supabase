import type { Prisma, PrismaClient, Vehicle } from "@/generated/prisma/client";
import { STALE_AFTER_SECONDS, ZONES, type Freshness } from "@/lib/constants";
import { getPrisma, WRITE_TRANSACTION_OPTIONS } from "@/lib/db";
import { buildEvent, writeDomainEventLogs } from "@/lib/domain/events";
import {
  serializeAnomaly,
  serializeVehicleState,
  serializeWarning,
} from "@/lib/domain/serializers";
import type {
  AnomalyOut,
  DashboardOut,
  DomainEvent,
  FleetStateOut,
  VehicleStateOut,
  WarningOut,
  ZoneCountOut,
} from "@/lib/domain/types";

type StaleVehicleRow = {
  vehicle_id: string;
  latest_timestamp: Date;
};

type DashboardClient = PrismaClient | Prisma.TransactionClient;

function freshnessFor(vehicle: Vehicle, now = new Date()): Freshness {
  if (!vehicle.latestTimestamp) {
    return "never_seen";
  }

  const ageSeconds =
    (now.getTime() - vehicle.latestTimestamp.getTime()) / 1000;
  return ageSeconds > STALE_AFTER_SECONDS ? "stale" : "fresh";
}

async function evaluateStaleVehicles() {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    const staleCutoff = new Date(Date.now() - STALE_AFTER_SECONDS * 1000);
    const rows = await tx.$queryRaw<StaleVehicleRow[]>`
      SELECT vehicle_id, latest_timestamp
      FROM vehicles
      WHERE latest_timestamp IS NOT NULL
        AND latest_timestamp <= ${staleCutoff}
        AND stale_episode_open = false
      FOR UPDATE
    `;
    const now = new Date();

    if (rows.length === 0) {
      return;
    }

    await tx.anomaly.createMany({
      data: rows.map((row) => ({
        vehicleId: row.vehicle_id,
        telemetryEventId: null,
        type: "STALE_TELEMETRY",
        severity: "medium",
        timestamp: now,
        details: {
          latest_timestamp: row.latest_timestamp.toISOString(),
          stale_after_seconds: STALE_AFTER_SECONDS,
        },
      })),
    });

    await tx.vehicle.updateMany({
      where: { vehicleId: { in: rows.map((row) => row.vehicle_id) } },
      data: { staleEpisodeOpen: true },
    });

    const pendingEvents: DomainEvent[] = rows.flatMap((row) => [
      buildEvent("TelemetryBecameStale", row.vehicle_id, {
        latest_timestamp: row.latest_timestamp.toISOString(),
      }),
      buildEvent("AnomalyDetected", row.vehicle_id, {
        type: "STALE_TELEMETRY",
        severity: "medium",
      }),
    ]);

    await writeDomainEventLogs(pendingEvents, tx);
  }, WRITE_TRANSACTION_OPTIONS);
}

async function vehicleStatesFrom(
  prisma: DashboardClient,
): Promise<VehicleStateOut[]> {
  const now = new Date();
  const vehicles = await prisma.vehicle.findMany({
    orderBy: { vehicleId: "asc" },
  });
  const vehicleIds = vehicles.map((vehicle) => vehicle.vehicleId);

  if (vehicleIds.length === 0) {
    return [];
  }

  const [latestAnomalies, latestWarnings] = await Promise.all([
    prisma.anomaly.findMany({
      where: { vehicleId: { in: vehicleIds } },
      orderBy: [
        { vehicleId: "asc" },
        { timestamp: "desc" },
        { id: "desc" },
      ],
      distinct: ["vehicleId"],
    }),
    prisma.warningRecord.findMany({
      where: { vehicleId: { in: vehicleIds } },
      orderBy: [
        { vehicleId: "asc" },
        { timestamp: "desc" },
        { id: "desc" },
      ],
      distinct: ["vehicleId"],
    }),
  ]);

  const anomalyByVehicle = new Map(
    latestAnomalies.map((anomaly) => [anomaly.vehicleId, anomaly]),
  );
  const warningByVehicle = new Map(
    latestWarnings.map((warning) => [warning.vehicleId, warning]),
  );

  return vehicles.map((vehicle) =>
    serializeVehicleState(
      vehicle,
      anomalyByVehicle.get(vehicle.vehicleId) ?? null,
      warningByVehicle.get(vehicle.vehicleId) ?? null,
      freshnessFor(vehicle, now),
    ),
  );
}

export async function listVehicleStates(): Promise<VehicleStateOut[]> {
  await evaluateStaleVehicles();
  return vehicleStatesFrom(getPrisma());
}

async function fleetStateFrom(prisma: DashboardClient): Promise<FleetStateOut> {
  const rows = await prisma.vehicle.groupBy({
    by: ["status"],
    _count: { status: true },
  });
  const state: FleetStateOut = { idle: 0, moving: 0, charging: 0, fault: 0 };

  for (const row of rows) {
    if (row.status in state) {
      state[row.status as keyof FleetStateOut] = row._count.status;
    }
  }

  return state;
}

export async function fleetState(): Promise<FleetStateOut> {
  return fleetStateFrom(getPrisma());
}

async function zoneCountsFrom(prisma: DashboardClient): Promise<ZoneCountOut[]> {
  const rows = await prisma.zoneCount.findMany();
  const byZone = new Map(rows.map((row) => [row.zoneId, row.entryCount]));

  return ZONES.map((zoneId) => ({
    zone_id: zoneId,
    entry_count: Number(byZone.get(zoneId) ?? BigInt(0)),
  }));
}

export async function zoneCounts(): Promise<ZoneCountOut[]> {
  return zoneCountsFrom(getPrisma());
}

async function anomaliesFrom(
  prisma: DashboardClient,
  input: {
    vehicleId?: string;
    startTime?: Date;
    endTime?: Date;
    limit: number;
  },
): Promise<AnomalyOut[]> {
  const where: Prisma.AnomalyWhereInput = {};

  if (input.vehicleId) where.vehicleId = input.vehicleId;
  if (input.startTime || input.endTime) {
    where.timestamp = {};
    if (input.startTime) where.timestamp.gte = input.startTime;
    if (input.endTime) where.timestamp.lte = input.endTime;
  }

  const rows = await prisma.anomaly.findMany({
    where,
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    take: input.limit,
  });

  return rows.map(serializeAnomaly);
}

export async function listAnomalies(input: {
  vehicleId?: string;
  startTime?: Date;
  endTime?: Date;
  limit: number;
}): Promise<AnomalyOut[]> {
  await evaluateStaleVehicles();
  return anomaliesFrom(getPrisma(), input);
}

async function warningsFrom(
  prisma: DashboardClient,
  input: {
    vehicleId?: string;
    startTime?: Date;
    endTime?: Date;
    limit: number;
  },
): Promise<WarningOut[]> {
  const where: Prisma.WarningRecordWhereInput = {};

  if (input.vehicleId) where.vehicleId = input.vehicleId;
  if (input.startTime || input.endTime) {
    where.timestamp = {};
    if (input.startTime) where.timestamp.gte = input.startTime;
    if (input.endTime) where.timestamp.lte = input.endTime;
  }

  const rows = await prisma.warningRecord.findMany({
    where,
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    take: input.limit,
  });

  return rows.map(serializeWarning);
}

export async function listWarnings(input: {
  vehicleId?: string;
  startTime?: Date;
  endTime?: Date;
  limit: number;
}): Promise<WarningOut[]> {
  return warningsFrom(getPrisma(), input);
}

export async function dashboardSnapshot(): Promise<DashboardOut> {
  await evaluateStaleVehicles();

  const prisma = getPrisma();
  const [vehicles, currentFleetState, currentZoneCounts, anomalies, warnings] =
    await Promise.all([
      vehicleStatesFrom(prisma),
      fleetStateFrom(prisma),
      zoneCountsFrom(prisma),
      anomaliesFrom(prisma, { limit: 100 }),
      warningsFrom(prisma, { limit: 100 }),
    ]);

  return {
    vehicles,
    fleetState: currentFleetState,
    zoneCounts: currentZoneCounts,
    anomalies,
    warnings,
  };
}
