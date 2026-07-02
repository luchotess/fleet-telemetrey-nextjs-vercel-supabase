import type { NextRequest } from "next/server";
import { ok, handleApiError } from "@/lib/api/responses";
import { listAnomalies } from "@/lib/domain/dashboard";
import { listQuerySchema } from "@/lib/domain/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const query = listQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    return ok(
      await listAnomalies({
        vehicleId: query.vehicle_id,
        startTime: query.start_time,
        endTime: query.end_time,
        limit: query.limit,
      }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
