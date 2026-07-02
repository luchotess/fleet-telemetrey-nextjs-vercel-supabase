import { randomUUID } from "node:crypto";
import type { Vehicle } from "@/generated/prisma/client";
import { ZONES, type VehicleStatus } from "@/lib/constants";
import { getPrisma, WRITE_TRANSACTION_OPTIONS } from "@/lib/db";
import { persistTelemetry } from "@/lib/domain/telemetry";
import type {
  CoalescedSimulationTickResult,
  SimulationTickResult,
  TelemetryInput,
} from "@/lib/domain/types";

interface SimulationTickOptions {
  limit?: number;
}

interface SimulationTickClaim {
  claimed: boolean;
  reason?: "locked" | "interval";
  waitMs?: number;
}

const AUTO_TICK_EVENT_TYPE = "simulator.auto_tick";
const AUTO_TICK_LOCK_KEY = "fleet-simulator-auto-tick";
const AUTO_SIMULATION_TICK_INTERVAL_MS = 3000;
const DEFAULT_SIMULATION_TICK_LIMIT = 10;

const statuses: VehicleStatus[] = ["moving", "idle", "charging"];

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number) {
  return Math.floor(randomBetween(min, max + 1));
}

function choice<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function numericVehicleOffset(vehicleId: string) {
  const parsed = Number.parseInt(vehicleId.replace(/\D/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 1;
}

function chooseStatus(batteryPct: number): VehicleStatus {
  if (Math.random() < 0.015) return "fault";
  if (batteryPct < 18 && Math.random() < 0.35) return "charging";
  return choice(statuses);
}

function buildSimulatedTelemetry(vehicle: Vehicle, timestamp: Date): TelemetryInput {
  const offset = numericVehicleOffset(vehicle.vehicleId);
  let lat = vehicle.lat ?? 37.41 + offset * 0.00008;
  let lon = vehicle.lon ?? -122.08 - offset * 0.00008;
  let batteryPct = vehicle.batteryPct ?? randomInt(35, 95);
  let status = chooseStatus(batteryPct);
  let speedMps = 0;

  if (status === "moving") {
    speedMps = randomBetween(0.6, 2.2);
    lat += randomBetween(-0.000025, 0.000025);
    lon += randomBetween(-0.000025, 0.000025);
  } else if (status === "charging") {
    batteryPct = Math.min(100, batteryPct + randomInt(0, 2));
  }

  if (Math.random() < 0.02) {
    lat += randomBetween(0.004, 0.008);
    lon += randomBetween(0.004, 0.008);
  }

  if (Math.random() < 0.025) {
    status = choice(["idle", "charging"] as const);
    speedMps = randomBetween(0.8, 2);
  }

  if (Math.random() < 0.025) {
    batteryPct = Math.max(0, batteryPct - randomInt(11, 18));
  } else if (status !== "charging") {
    batteryPct = Math.max(0, batteryPct - choice([0, 0, 1] as const));
  }

  if (Math.random() < 0.02) {
    batteryPct = randomInt(5, 14);
  }

  const errorCodes: string[] = [];
  if (Math.random() < 0.025) {
    errorCodes.push(choice(["E_DRIVE", "E_BRAKE", "E_SENSOR"] as const));
  }
  if (status === "fault" && errorCodes.length === 0) {
    errorCodes.push(choice(["F_MOTOR", "F_BATTERY", "F_NAV"] as const));
  }

  return {
    vehicle_id: vehicle.vehicleId,
    timestamp,
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    battery_pct: batteryPct,
    speed_mps: Number(speedMps.toFixed(2)),
    status,
    error_codes: errorCodes,
    zone_entered: Math.random() < 0.08 ? choice(ZONES) : null,
  };
}

async function ensureSimulationSession(vehicleId: string) {
  const prisma = getPrisma();
  const now = new Date();
  const activeSession = await prisma.telemetrySession.findFirst({
    where: {
      vehicleId,
      active: true,
      expiresAt: { gt: now },
    },
    orderBy: { expiresAt: "desc" },
  });

  if (activeSession) {
    return activeSession.id;
  }

  const session = await prisma.telemetrySession.create({
    data: {
      id: randomUUID(),
      vehicleId,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      active: true,
    },
  });

  return session.id;
}

async function runSimulationTick(
  options: SimulationTickOptions = {},
): Promise<SimulationTickResult> {
  const prisma = getPrisma();
  const limit = Math.min(
    Math.max(options.limit ?? DEFAULT_SIMULATION_TICK_LIMIT, 1),
    50,
  );
  const vehicles = await prisma.vehicle.findMany({
    orderBy: [
      { latestTimestamp: { sort: "asc", nulls: "first" } },
      { vehicleId: "asc" },
    ],
    take: limit,
  });
  const result: SimulationTickResult = {
    accepted: 0,
    failed: 0,
    vehicle_count: vehicles.length,
    errors: [],
  };
  const baseTime = Date.now();

  for (const [index, vehicle] of vehicles.entries()) {
    try {
      const sessionId = await ensureSimulationSession(vehicle.vehicleId);
      await persistTelemetry(
        buildSimulatedTelemetry(vehicle, new Date(baseTime + index)),
        vehicle.vehicleId,
        sessionId,
      );
      result.accepted += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        vehicle_id: vehicle.vehicleId,
        detail: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return result;
}

async function claimAutoSimulationTick(
  minIntervalMs: number,
): Promise<SimulationTickClaim> {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtext(${AUTO_TICK_LOCK_KEY})) AS locked
    `;

    if (!lockRows[0]?.locked) {
      return { claimed: false, reason: "locked" };
    }

    const latestTick = await tx.domainEventLog.findFirst({
      where: { eventType: AUTO_TICK_EVENT_TYPE },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    if (latestTick) {
      const elapsedMs = Date.now() - latestTick.createdAt.getTime();
      const waitMs = minIntervalMs - elapsedMs;

      if (waitMs > 0) {
        return { claimed: false, reason: "interval", waitMs };
      }
    }

    await tx.domainEventLog.create({
      data: {
        eventType: AUTO_TICK_EVENT_TYPE,
        aggregateId: "fleet",
        payload: {
          interval_ms: minIntervalMs,
          requested_at: new Date().toISOString(),
        },
      },
    });

    return { claimed: true };
  }, WRITE_TRANSACTION_OPTIONS);
}

export async function runCoalescedSimulationTick(
  options: SimulationTickOptions = {},
): Promise<CoalescedSimulationTickResult> {
  const claim = await claimAutoSimulationTick(AUTO_SIMULATION_TICK_INTERVAL_MS);

  if (!claim.claimed) {
    return {
      accepted: 0,
      failed: 0,
      vehicle_count: 0,
      errors: [],
      skipped: true,
      reason: claim.reason,
      next_tick_after_ms: claim.waitMs,
    };
  }

  const result = await runSimulationTick(options);
  return { ...result, skipped: false };
}
