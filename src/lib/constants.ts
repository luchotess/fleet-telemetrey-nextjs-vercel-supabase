export const ZONES = [
  "inbound_dock_a",
  "inbound_dock_b",
  "receiving_staging",
  "aisle_a",
  "aisle_b",
  "aisle_c",
  "high_bay_1",
  "high_bay_2",
  "bulk_storage",
  "pick_zone_1",
  "pick_zone_2",
  "pack_station",
  "sort_belt",
  "outbound_dock_a",
  "outbound_dock_b",
  "shipping_staging",
  "charging_bay_1",
  "charging_bay_2",
  "charging_bay_3",
  "maintenance_bay",
] as const;

export const VEHICLE_STATUSES = ["idle", "moving", "charging", "fault"] as const;

function numberFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const STALE_AFTER_SECONDS = numberFromEnv("STALE_AFTER_SECONDS", 10);
export const RATE_LIMIT_REQUESTS = 15;
export const RATE_LIMIT_WINDOW_SECONDS = 10;
export const LOW_BATTERY_THRESHOLD = 15;

export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];
export type Freshness = "never_seen" | "fresh" | "stale";
