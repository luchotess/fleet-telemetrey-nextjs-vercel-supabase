import { z } from "zod";
import { VEHICLE_STATUSES } from "@/lib/constants";

function parseTelemetryTimestamp(value: string) {
  const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value);
  const normalized = hasTimezone ? value : `${value}Z`;
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

export const vehicleTokenRequestSchema = z.object({
  vehicle_id: z.string().min(1),
});

export const telemetryInputSchema = z.object({
  vehicle_id: z.string().min(1),
  timestamp: z
    .string()
    .min(1)
    .transform((value, ctx) => {
      const parsed = parseTelemetryTimestamp(value);
      if (!parsed) {
        ctx.addIssue({
          code: "custom",
          message: "timestamp must be a valid ISO datetime",
        });
        return z.NEVER;
      }
      return parsed;
    }),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  battery_pct: z.number().int().min(0).max(100),
  speed_mps: z.number().min(0),
  status: z.enum(VEHICLE_STATUSES),
  error_codes: z.array(z.string()).default([]),
  zone_entered: z.string().nullable().optional().default(null),
});

export const listQuerySchema = z.object({
  vehicle_id: z.string().min(1).optional(),
  start_time: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return undefined;
      const parsed = parseTelemetryTimestamp(value);
      if (!parsed) {
        ctx.addIssue({
          code: "custom",
          message: "start_time must be a valid ISO datetime",
        });
        return z.NEVER;
      }
      return parsed;
    }),
  end_time: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return undefined;
      const parsed = parseTelemetryTimestamp(value);
      if (!parsed) {
        ctx.addIssue({
          code: "custom",
          message: "end_time must be a valid ISO datetime",
        });
        return z.NEVER;
      }
      return parsed;
    }),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const simulatorTickRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(50),
});
