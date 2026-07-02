import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { handleApiError, ok, readJson } from "@/lib/api/responses";
import { getPrisma } from "@/lib/db";
import { getAppEnv } from "@/lib/env";
import { enforceApiRateLimit } from "@/lib/domain/rate-limit";
import { runCoalescedSimulationTick } from "@/lib/domain/simulator";
import { simulatorTickRequestSchema } from "@/lib/domain/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function clientIdentity(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip =
    forwardedFor?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const userAgent = request.headers.get("user-agent") ?? "unknown";

  return createHash("sha256")
    .update(`${ip}|${userAgent}`)
    .digest("hex")
    .slice(0, 64);
}

export async function POST(request: NextRequest) {
  try {
    const body =
      request.headers.get("content-type")?.includes("application/json")
        ? await readJson(request)
        : {};
    const input = simulatorTickRequestSchema.parse({
      ...Object.fromEntries(request.nextUrl.searchParams),
      ...(body && typeof body === "object" ? body : {}),
    });
    const identity = clientIdentity(request);
    const env = getAppEnv();

    await getPrisma().$transaction((tx) =>
      enforceApiRateLimit(tx, {
        scope: "simulator_tick",
        identifier: identity,
        limit: env.SIMULATOR_TICK_RATE_LIMIT_REQUESTS,
        windowSeconds: env.SIMULATOR_TICK_RATE_LIMIT_WINDOW_SECONDS,
        message: "Simulator tick rate limit exceeded",
      }),
    );

    const result = await runCoalescedSimulationTick({ limit: input.limit });
    console.info("simulator.tick", {
      identity,
      limit: input.limit,
      accepted: result.accepted,
      failed: result.failed,
      skipped: result.skipped,
      reason: result.reason,
      next_tick_after_ms: result.next_tick_after_ms,
    });

    return ok(result);
  } catch (error) {
    return handleApiError(error);
  }
}
