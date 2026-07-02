import type {
  Anomaly,
  Vehicle,
  WarningRecord,
} from "@/generated/prisma/client";
import type {
  AnomalyOut,
  VehicleStateOut,
  WarningOut,
} from "@/lib/domain/types";

export function serializeAnomaly(anomaly: Anomaly): AnomalyOut {
  return {
    id: anomaly.id,
    vehicle_id: anomaly.vehicleId,
    telemetry_event_id: anomaly.telemetryEventId,
    type: anomaly.type,
    severity: anomaly.severity,
    timestamp: anomaly.timestamp.toISOString(),
    details: anomaly.details,
  };
}

export function serializeWarning(warning: WarningRecord): WarningOut {
  return {
    id: warning.id,
    vehicle_id: warning.vehicleId,
    telemetry_event_id: warning.telemetryEventId,
    type: warning.type,
    timestamp: warning.timestamp.toISOString(),
    details: warning.details,
  };
}

export function serializeVehicleState(
  vehicle: Vehicle,
  latestAnomaly: Anomaly | null,
  latestWarning: WarningRecord | null,
  freshness: VehicleStateOut["freshness"],
): VehicleStateOut {
  return {
    vehicle_id: vehicle.vehicleId,
    latest_timestamp: vehicle.latestTimestamp?.toISOString() ?? null,
    status: vehicle.status as VehicleStateOut["status"],
    battery_pct: vehicle.batteryPct,
    speed_mps: vehicle.speedMps,
    lat: vehicle.lat,
    lon: vehicle.lon,
    active_mission_id: vehicle.activeMissionId,
    latest_anomaly: latestAnomaly ? serializeAnomaly(latestAnomaly) : null,
    latest_warning: latestWarning ? serializeWarning(latestWarning) : null,
    freshness,
  };
}
