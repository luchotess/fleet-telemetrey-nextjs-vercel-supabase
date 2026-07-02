import { handleApiError, ok } from "@/lib/api/responses";
import { dashboardSnapshot } from "@/lib/domain/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    return ok(await dashboardSnapshot());
  } catch (error) {
    return handleApiError(error);
  }
}
