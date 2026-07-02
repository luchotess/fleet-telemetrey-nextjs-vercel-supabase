import type { Prisma } from "@/generated/prisma/client";
import type { Freshness, VehicleStatus } from "@/lib/constants";

export interface DomainEvent {
  eventType: string;
  aggregateId: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export interface TelemetryInput {
  vehicle_id: string;
  timestamp: Date;
  lat: number;
  lon: number;
  battery_pct: number;
  speed_mps: number;
  status: VehicleStatus;
  error_codes: string[];
  zone_entered: string | null;
}

export interface AnomalySpec {
  type: string;
  severity: string;
  details: Prisma.InputJsonObject;
}

export interface AnomalyOut {
  id: number;
  vehicle_id: string;
  telemetry_event_id: number | null;
  type: string;
  severity: string;
  timestamp: string;
  details: unknown;
}

export interface WarningOut {
  id: number;
  vehicle_id: string;
  telemetry_event_id: number | null;
  type: string;
  timestamp: string;
  details: unknown;
}

export interface VehicleStateOut {
  vehicle_id: string;
  latest_timestamp: string | null;
  status: VehicleStatus;
  battery_pct: number | null;
  speed_mps: number | null;
  lat: number | null;
  lon: number | null;
  active_mission_id: number | null;
  latest_anomaly: AnomalyOut | null;
  latest_warning: WarningOut | null;
  freshness: Freshness;
}

export interface FleetStateOut {
  idle: number;
  moving: number;
  charging: number;
  fault: number;
}

export interface ZoneCountOut {
  zone_id: string;
  entry_count: number;
}

export interface DashboardOut {
  vehicles: VehicleStateOut[];
  fleetState: FleetStateOut;
  zoneCounts: ZoneCountOut[];
  anomalies: AnomalyOut[];
  warnings: WarningOut[];
}

export interface SimulationTickResult {
  accepted: number;
  failed: number;
  vehicle_count: number;
  errors: Array<{ vehicle_id: string; detail: string }>;
}

export interface CoalescedSimulationTickResult extends SimulationTickResult {
  skipped: boolean;
  reason?: "locked" | "interval";
  next_tick_after_ms?: number;
}
