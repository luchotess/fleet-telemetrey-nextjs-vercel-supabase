import { ok, handleApiError } from "@/lib/api/responses";
import { listVehicleStates } from "@/lib/domain/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    return ok(await listVehicleStates());
  } catch (error) {
    return handleApiError(error);
  }
}
