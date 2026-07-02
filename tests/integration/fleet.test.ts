import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPrisma } from "@/lib/db";
import { createVehicleJwt, issueVehicleToken } from "@/lib/domain/auth";
import {
  dashboardSnapshot,
  fleetState,
  listVehicleStates,
} from "@/lib/domain/dashboard";
import { enforceApiRateLimit } from "@/lib/domain/rate-limit";
import { seedReferenceData } from "@/lib/domain/seed";
import { runCoalescedSimulationTick } from "@/lib/domain/simulator";
import { persistTelemetry } from "@/lib/domain/telemetry";
import type { TelemetryInput } from "@/lib/domain/types";
import { AppError } from "@/lib/errors";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://fleet:fleet@localhost:5433/fleet_test?schema=public";

process.env.DATABASE_URL = testDatabaseUrl;
process.env.DIRECT_URL = process.env.DIRECT_URL ?? testDatabaseUrl;
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret";

const prisma = getPrisma();

function telemetryPayload(
  vehicleId = "v-1",
  timestamp = new Date(),
  overrides: Partial<TelemetryInput> = {},
): TelemetryInput {
  return {
    vehicle_id: vehicleId,
    timestamp,
    lat: 37.41,
    lon: -122.08,
    battery_pct: 78,
    speed_mps: 1.2,
    status: "moving",
    error_codes: [],
    zone_entered: null,
    ...overrides,
  };
}

async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      api_rate_limit_hits,
      domain_event_logs,
      maintenance_records,
      missions,
      warnings,
      anomalies,
      telemetry_events,
      telemetry_sessions,
      telemetry_rate_limit_hits,
      vehicles,
      zone_counts
    RESTART IDENTITY CASCADE
  `);
  await seedReferenceData(prisma);
}

async function sessionFor(vehicleId: string) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
  const sessionId = randomUUID();
  await prisma.telemetrySession.create({
    data: {
      id: sessionId,
      vehicleId,
      issuedAt: now,
      expiresAt,
      active: true,
    },
  });
  return {
    sessionId,
    token: await createVehicleJwt(vehicleId, sessionId, now, expiresAt),
  };
}

describe.sequential("fleet service", () => {
  beforeAll(() => {
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      env: {
        ...process.env,
        DATABASE_URL: testDatabaseUrl,
        DIRECT_URL: testDatabaseUrl,
      },
      stdio: "inherit",
    });
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates tokens and rejects duplicate active sessions", async () => {
    const first = await issueVehicleToken("v-12");
    expect(first.token).toBeTruthy();
    await expect(issueVehicleToken("v-12")).rejects.toMatchObject({
      status: 409,
    });
  });

  it("rejects token vehicle_id mismatch", async () => {
    const { sessionId } = await sessionFor("v-1");
    await expect(
      persistTelemetry(telemetryPayload("v-2"), "v-1", sessionId),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("detects deterministic anomalies", async () => {
    const { sessionId } = await sessionFor("v-4");
    const baseTime = new Date();

    await persistTelemetry(
      telemetryPayload("v-4", baseTime, {
        battery_pct: 90,
        error_codes: ["E42"],
      }),
      "v-4",
      sessionId,
    );
    await persistTelemetry(
      telemetryPayload("v-4", new Date(baseTime.getTime() + 10_000), {
        lat: 37.42,
        battery_pct: 75,
        status: "idle",
        speed_mps: 1,
        error_codes: ["E42"],
      }),
      "v-4",
      sessionId,
    );
    await persistTelemetry(
      telemetryPayload("v-4", new Date(baseTime.getTime() + 20_000), {
        battery_pct: 70,
        error_codes: ["E42"],
      }),
      "v-4",
      sessionId,
    );

    const anomalies = await prisma.anomaly.findMany({
      where: { vehicleId: "v-4" },
    });
    expect(anomalies.map((row) => row.type)).toEqual(
      expect.arrayContaining([
        "GPS_JUMP",
        "STATUS_SPEED_CONFLICT",
        "BATTERY_DRAIN_SPIKE",
        "REPEATED_FAULT_CODES",
      ]),
    );
  });

  it("classifies low battery as a warning, not an anomaly", async () => {
    const { sessionId } = await sessionFor("v-5");
    const result = await persistTelemetry(
      telemetryPayload("v-5", new Date(), { battery_pct: 10 }),
      "v-5",
      sessionId,
    );

    expect(result.warnings).toEqual(["LOW_BATTERY_WARNING"]);
    expect(
      await prisma.anomaly.findMany({
        where: { vehicleId: "v-5", type: "LOW_BATTERY_WARNING" },
      }),
    ).toEqual([]);
  });

  it("increments zone counters under concurrent writes", async () => {
    const now = new Date();
    await Promise.all(
      Array.from({ length: 20 }).map(async (_, index) => {
        const vehicleId = `v-${index + 1}`;
        const { sessionId } = await sessionFor(vehicleId);
        return persistTelemetry(
          telemetryPayload(vehicleId, new Date(now.getTime() + index), {
            zone_entered: "pack_station",
          }),
          vehicleId,
          sessionId,
        );
      }),
    );

    const count = await prisma.zoneCount.findUniqueOrThrow({
      where: { zoneId: "pack_station" },
    });
    expect(count.entryCount).toBe(BigInt(20));
  });

  it("cancels active mission and creates maintenance on fault transition", async () => {
    const mission = await prisma.mission.create({
      data: { vehicleId: "v-7", status: "active" },
    });
    await prisma.vehicle.update({
      where: { vehicleId: "v-7" },
      data: { activeMissionId: mission.id },
    });
    const { sessionId } = await sessionFor("v-7");

    await persistTelemetry(
      telemetryPayload("v-7", new Date(), {
        status: "fault",
        speed_mps: 0,
        error_codes: ["F999"],
      }),
      "v-7",
      sessionId,
    );

    await expect(prisma.vehicle.findUniqueOrThrow({ where: { vehicleId: "v-7" } }))
      .resolves.toMatchObject({ status: "fault" });
    await expect(prisma.mission.findUniqueOrThrow({ where: { id: mission.id } }))
      .resolves.toMatchObject({ status: "cancelled" });
    await expect(prisma.maintenanceRecord.count({ where: { vehicleId: "v-7" } }))
      .resolves.toBe(1);
  });

  it("does not let out-of-order telemetry overwrite current state", async () => {
    const { sessionId } = await sessionFor("v-8");
    const baseTime = new Date();

    await persistTelemetry(
      telemetryPayload("v-8", new Date(baseTime.getTime() + 30_000), {
        battery_pct: 55,
      }),
      "v-8",
      sessionId,
    );
    await persistTelemetry(
      telemetryPayload("v-8", baseTime, {
        status: "idle",
        speed_mps: 0,
        battery_pct: 95,
      }),
      "v-8",
      sessionId,
    );

    await expect(prisma.vehicle.findUniqueOrThrow({ where: { vehicleId: "v-8" } }))
      .resolves.toMatchObject({ batteryPct: 55 });
    await expect(prisma.telemetryEvent.count({ where: { vehicleId: "v-8" } }))
      .resolves.toBe(2);
  });

  it("enforces per-vehicle rate limits", async () => {
    const { sessionId } = await sessionFor("v-9");
    const baseTime = new Date();

    for (let i = 0; i < 15; i += 1) {
      await persistTelemetry(
        telemetryPayload("v-9", new Date(baseTime.getTime() + i)),
        "v-9",
        sessionId,
      );
    }

    await expect(
      persistTelemetry(
        telemetryPayload("v-9", new Date(baseTime.getTime() + 16)),
        "v-9",
        sessionId,
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("writes domain event logs after successful telemetry", async () => {
    const { sessionId } = await sessionFor("v-10");
    await persistTelemetry(
      telemetryPayload("v-10", new Date(), { zone_entered: "sort_belt" }),
      "v-10",
      sessionId,
    );

    const eventTypes = new Set(
      (
        await prisma.domainEventLog.findMany({
          where: { aggregateId: { in: ["v-10", "sort_belt"] } },
        })
      ).map((row) => row.eventType),
    );
    expect(eventTypes.has("TelemetryReceived")).toBe(true);
    expect(eventTypes.has("VehicleStateUpdated")).toBe(true);
    expect(eventTypes.has("ZoneEntryCountIncremented")).toBe(true);
  });

  it("persists stale telemetry once per episode", async () => {
    await prisma.vehicle.update({
      where: { vehicleId: "v-11" },
      data: {
        latestTimestamp: new Date(Date.now() - 20_000),
        status: "moving",
      },
    });

    await listVehicleStates();
    await listVehicleStates();

    await expect(
      prisma.anomaly.count({
        where: { vehicleId: "v-11", type: "STALE_TELEMETRY" },
      }),
    ).resolves.toBe(1);
  });

  it("returns fleet aggregate state", async () => {
    await prisma.vehicle.update({ where: { vehicleId: "v-1" }, data: { status: "moving" } });
    await prisma.vehicle.update({ where: { vehicleId: "v-2" }, data: { status: "charging" } });
    await prisma.vehicle.update({ where: { vehicleId: "v-3" }, data: { status: "fault" } });

    await expect(fleetState()).resolves.toEqual({
      idle: 47,
      moving: 1,
      charging: 1,
      fault: 1,
    });
  });

  it("returns a dashboard snapshot in one domain call", async () => {
    const snapshot = await dashboardSnapshot();

    expect(snapshot.vehicles).toHaveLength(50);
    expect(snapshot.zoneCounts.length).toBeGreaterThan(0);
    expect(snapshot.fleetState).toEqual({
      idle: 50,
      moving: 0,
      charging: 0,
      fault: 0,
    });
  });

  it("enforces persistent API rate limits for public simulator ticks", async () => {
    const input = {
      scope: "simulator_tick",
      identifier: "integration-test-client",
      limit: 2,
      windowSeconds: 60,
      message: "Simulator tick rate limit exceeded",
    };

    await prisma.$transaction((tx) => enforceApiRateLimit(tx, input));
    await prisma.$transaction((tx) => enforceApiRateLimit(tx, input));

    await expect(
      prisma.$transaction((tx) => enforceApiRateLimit(tx, input)),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("coalesces dashboard simulator ticks to one write window", async () => {
    const first = await runCoalescedSimulationTick();
    const second = await runCoalescedSimulationTick();

    expect(first.skipped).toBe(false);
    expect(first.accepted).toBe(5);
    expect(second.skipped).toBe(true);
    await expect(prisma.telemetryEvent.count()).resolves.toBe(5);
    await expect(
      prisma.domainEventLog.count({
        where: { eventType: "simulator.auto_tick" },
      }),
    ).resolves.toBe(1);
  });
});
