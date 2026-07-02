import type { Prisma } from "@/generated/prisma/client";
import {
  LOW_BATTERY_THRESHOLD,
  ZONES,
} from "@/lib/constants";
import { getPrisma } from "@/lib/db";
import { detectAnomalies, nearestPriorTelemetry } from "@/lib/domain/anomaly";
import { requireActiveSession } from "@/lib/domain/auth";
import { buildEvent, writeDomainEventLogs } from "@/lib/domain/events";
import { enforceTelemetryRateLimit } from "@/lib/domain/rate-limit";
import type { DomainEvent, TelemetryInput } from "@/lib/domain/types";
import { AppError } from "@/lib/errors";

export async function persistTelemetry(
  payload: TelemetryInput,
  authenticatedVehicleId: string,
  sessionId: string,
) {
  if (payload.vehicle_id !== authenticatedVehicleId) {
    throw new AppError(403, "Telemetry vehicle_id does not match token");
  }

  if (
    payload.zone_entered !== null &&
    !ZONES.some((zoneId) => zoneId === payload.zone_entered)
  ) {
    throw new AppError(422, "zone_entered is not a known zone");
  }

  const prisma = getPrisma();
  const result = await prisma.$transaction(async (tx) => {
    await enforceTelemetryRateLimit(tx, authenticatedVehicleId);
    await requireActiveSession(tx, authenticatedVehicleId, sessionId);

    const lockedVehicles = await tx.$queryRaw<{ vehicle_id: string }[]>`
      SELECT vehicle_id FROM vehicles
      WHERE vehicle_id = ${payload.vehicle_id}
      FOR UPDATE
    `;

    if (lockedVehicles.length === 0) {
      throw new AppError(404, "Vehicle not found");
    }

    const vehicle = await tx.vehicle.findUniqueOrThrow({
      where: { vehicleId: payload.vehicle_id },
    });
    const previous = await nearestPriorTelemetry(tx, payload);

    const telemetryEvent = await tx.telemetryEvent.create({
      data: {
        vehicleId: payload.vehicle_id,
        sessionId,
        timestamp: payload.timestamp,
        lat: payload.lat,
        lon: payload.lon,
        batteryPct: payload.battery_pct,
        speedMps: payload.speed_mps,
        status: payload.status,
        errorCodes: payload.error_codes,
        zoneEntered: payload.zone_entered,
      },
    });

    const events: DomainEvent[] = [
      buildEvent("TelemetryReceived", payload.vehicle_id, {
        telemetry_event_id: telemetryEvent.id,
        timestamp: payload.timestamp.toISOString(),
      }),
    ];

    const anomalySpecs = await detectAnomalies(tx, payload, previous);
    for (const spec of anomalySpecs) {
      await tx.anomaly.create({
        data: {
          vehicleId: payload.vehicle_id,
          telemetryEventId: telemetryEvent.id,
          type: spec.type,
          severity: spec.severity,
          timestamp: payload.timestamp,
          details: spec.details,
        },
      });
      events.push(
        buildEvent("AnomalyDetected", payload.vehicle_id, {
          type: spec.type,
          severity: spec.severity,
          telemetry_event_id: telemetryEvent.id,
        }),
      );
    }

    const warnings: string[] = [];
    if (payload.battery_pct < LOW_BATTERY_THRESHOLD) {
      const warning = await tx.warningRecord.create({
        data: {
          vehicleId: payload.vehicle_id,
          telemetryEventId: telemetryEvent.id,
          type: "LOW_BATTERY_WARNING",
          timestamp: payload.timestamp,
          details: {
            battery_pct: payload.battery_pct,
            threshold_pct: LOW_BATTERY_THRESHOLD,
          },
        },
      });
      warnings.push(warning.type);
      events.push(
        buildEvent("WarningRaised", payload.vehicle_id, {
          type: warning.type,
          telemetry_event_id: telemetryEvent.id,
        }),
      );
    }

    if (payload.zone_entered !== null) {
      await tx.zoneCount.update({
        where: { zoneId: payload.zone_entered },
        data: { entryCount: { increment: 1 } },
      });
      events.push(
        buildEvent("ZoneEntered", payload.vehicle_id, {
          zone_id: payload.zone_entered,
          telemetry_event_id: telemetryEvent.id,
        }),
        buildEvent("ZoneEntryCountIncremented", payload.zone_entered, {
          zone_id: payload.zone_entered,
        }),
      );
    }

    const shouldUpdateState =
      vehicle.latestTimestamp === null ||
      payload.timestamp > vehicle.latestTimestamp;

    if (shouldUpdateState) {
      await updateCurrentVehicleState(tx, {
        events,
        payload,
        telemetryEventId: telemetryEvent.id,
        previousStatus: vehicle.status,
        activeMissionId: vehicle.activeMissionId,
      });
    }

    await writeDomainEventLogs(events, tx);

    return {
      telemetry_event_id: telemetryEvent.id,
      anomalies: anomalySpecs.map((spec) => spec.type),
      warnings,
    };
  });

  return {
    telemetry_event_id: result.telemetry_event_id,
    anomalies: result.anomalies,
    warnings: result.warnings,
  };
}

async function updateCurrentVehicleState(
  tx: Prisma.TransactionClient,
  input: {
    events: DomainEvent[];
    payload: TelemetryInput;
    telemetryEventId: number;
    previousStatus: string;
    activeMissionId: number | null;
  },
) {
  const {
    events,
    payload,
    telemetryEventId,
    previousStatus,
    activeMissionId,
  } = input;
  const transitioningToFault =
    previousStatus !== "fault" && payload.status === "fault";

  await tx.vehicle.update({
    where: { vehicleId: payload.vehicle_id },
    data: {
      latestTimestamp: payload.timestamp,
      status: payload.status,
      batteryPct: payload.battery_pct,
      speedMps: payload.speed_mps,
      lat: payload.lat,
      lon: payload.lon,
      staleEpisodeOpen: false,
    },
  });

  events.push(
    buildEvent("VehicleStateUpdated", payload.vehicle_id, {
      previous_status: previousStatus,
      status: payload.status,
      latest_timestamp: payload.timestamp.toISOString(),
    }),
  );

  if (!transitioningToFault) {
    return;
  }

  if (activeMissionId !== null) {
    const mission = await tx.mission.findUnique({
      where: { id: activeMissionId },
    });
    if (mission?.status === "active") {
      await tx.mission.update({
        where: { id: mission.id },
        data: {
          status: "cancelled",
          cancelledAt: new Date(),
        },
      });
      events.push(
        buildEvent("MissionCancelled", payload.vehicle_id, {
          mission_id: mission.id,
          telemetry_event_id: telemetryEventId,
        }),
      );
    }
  }

  const maintenanceRecord = await tx.maintenanceRecord.create({
    data: {
      vehicleId: payload.vehicle_id,
      telemetryEventId,
      reason: "Vehicle entered fault status from telemetry",
    },
  });

  events.push(
    buildEvent("MaintenanceRecordCreated", payload.vehicle_id, {
      maintenance_record_id: maintenanceRecord.id,
      telemetry_event_id: telemetryEventId,
    }),
    buildEvent("VehicleFaulted", payload.vehicle_id, {
      telemetry_event_id: telemetryEventId,
    }),
  );
}
