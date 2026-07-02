import type { Prisma, TelemetryEvent } from "@/generated/prisma/client";
import type { AnomalySpec, TelemetryInput } from "@/lib/domain/types";

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const radiusMeters = 6_371_000;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) *
      Math.cos(radians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * radiusMeters * Math.asin(Math.sqrt(a));
}

function radians(value: number) {
  return (value * Math.PI) / 180;
}

export async function nearestPriorTelemetry(
  tx: Prisma.TransactionClient,
  payload: TelemetryInput,
) {
  return tx.telemetryEvent.findFirst({
    where: {
      vehicleId: payload.vehicle_id,
      timestamp: { lt: payload.timestamp },
    },
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
  });
}

export async function detectAnomalies(
  tx: Prisma.TransactionClient,
  payload: TelemetryInput,
  previous: TelemetryEvent | null,
): Promise<AnomalySpec[]> {
  const anomalies: AnomalySpec[] = [];

  if (previous) {
    const seconds =
      (payload.timestamp.getTime() - previous.timestamp.getTime()) / 1000;

    if (seconds > 0) {
      const speed =
        haversineMeters(previous.lat, previous.lon, payload.lat, payload.lon) /
        seconds;

      if (speed > 12) {
        anomalies.push({
          type: "GPS_JUMP",
          severity: "high",
          details: {
            implied_speed_mps: Number(speed.toFixed(2)),
            threshold_mps: 12,
            previous_telemetry_event_id: previous.id,
          },
        });
      }

      const batteryDrop = previous.batteryPct - payload.battery_pct;
      if (seconds <= 60 && batteryDrop > 10) {
        anomalies.push({
          type: "BATTERY_DRAIN_SPIKE",
          severity: "medium",
          details: {
            battery_drop_pct: batteryDrop,
            elapsed_seconds: Number(seconds.toFixed(2)),
            previous_telemetry_event_id: previous.id,
          },
        });
      }
    }
  }

  if (
    (payload.status === "idle" || payload.status === "charging") &&
    payload.speed_mps > 0.5
  ) {
    anomalies.push({
      type: "STATUS_SPEED_CONFLICT",
      severity: "medium",
      details: {
        status: payload.status,
        speed_mps: payload.speed_mps,
        threshold_mps: 0.5,
      },
    });
  }

  if (payload.error_codes.length > 0) {
    const windowStart = new Date(payload.timestamp.getTime() - 5 * 60 * 1000);
    const recentEvents = await tx.telemetryEvent.findMany({
      select: { errorCodes: true },
      where: {
        vehicleId: payload.vehicle_id,
        timestamp: {
          gte: windowStart,
          lte: payload.timestamp,
        },
      },
    });

    const counts = new Map<string, number>();
    for (const event of recentEvents) {
      const codes = Array.isArray(event.errorCodes) ? event.errorCodes : [];
      for (const code of new Set(codes.filter((item) => typeof item === "string"))) {
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
    }

    for (const code of new Set(payload.error_codes)) {
      const count = counts.get(code) ?? 0;
      if (count >= 3) {
        anomalies.push({
          type: "REPEATED_FAULT_CODES",
          severity: "high",
          details: {
            error_code: code,
            occurrences_in_5m: count,
          },
        });
      }
    }
  }

  return anomalies;
}
