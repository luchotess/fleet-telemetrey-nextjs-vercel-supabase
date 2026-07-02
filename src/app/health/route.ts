import { ok } from "@/lib/api/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return ok({ status: "ok" });
}
