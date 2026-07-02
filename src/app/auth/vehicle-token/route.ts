import { issueVehicleToken } from "@/lib/domain/auth";
import { vehicleTokenRequestSchema } from "@/lib/domain/validation";
import { handleApiError, ok, readJson } from "@/lib/api/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const body = vehicleTokenRequestSchema.parse(await readJson(request));
    return ok(await issueVehicleToken(body.vehicle_id));
  } catch (error) {
    return handleApiError(error);
  }
}
