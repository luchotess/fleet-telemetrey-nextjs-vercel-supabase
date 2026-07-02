import { bearerToken } from "@/lib/api/auth";
import { handleApiError, ok, readJson } from "@/lib/api/responses";
import { decodeVehicleJwt } from "@/lib/domain/auth";
import { persistTelemetry } from "@/lib/domain/telemetry";
import { telemetryInputSchema } from "@/lib/domain/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const payload = telemetryInputSchema.parse(await readJson(request));
    const claims = await decodeVehicleJwt(bearerToken(request));
    return ok(await persistTelemetry(payload, claims.vehicle_id, claims.session_id));
  } catch (error) {
    return handleApiError(error);
  }
}
