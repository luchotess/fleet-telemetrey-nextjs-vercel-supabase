import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import type { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/db";
import { getAppEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

const encoder = new TextEncoder();

function jwtSecret() {
  return encoder.encode(getAppEnv().JWT_SECRET);
}

function jwtAlgorithm() {
  return getAppEnv().JWT_ALGORITHM;
}

function utcNow() {
  return new Date();
}

export interface VehicleJwtClaims {
  vehicle_id: string;
  session_id: string;
  issued_at: string;
  expires_at: string;
}

export async function createVehicleJwt(
  vehicleId: string,
  sessionId: string,
  issuedAt: Date,
  expiresAt: Date,
) {
  return new SignJWT({
    vehicle_id: vehicleId,
    session_id: sessionId,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  })
    .setProtectedHeader({ alg: jwtAlgorithm() })
    .setIssuedAt(Math.floor(issuedAt.getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(jwtSecret());
}

export async function decodeVehicleJwt(token: string): Promise<VehicleJwtClaims> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret(), {
      algorithms: [jwtAlgorithm()],
    });
    const vehicleId = payload.vehicle_id;
    const sessionId = payload.session_id;

    if (typeof vehicleId !== "string" || typeof sessionId !== "string") {
      throw new AppError(401, "Invalid telemetry token claims");
    }

    return {
      vehicle_id: vehicleId,
      session_id: sessionId,
      issued_at: String(payload.issued_at ?? ""),
      expires_at: String(payload.expires_at ?? ""),
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    const message =
      error instanceof Error && error.message.toLowerCase().includes("expired")
        ? "Telemetry token has expired"
        : "Invalid telemetry token";
    throw new AppError(401, message);
  }
}

export async function issueVehicleToken(vehicleId: string) {
  const prisma = getPrisma();
  const vehicle = await prisma.vehicle.findUnique({ where: { vehicleId } });
  if (!vehicle) {
    throw new AppError(404, "Vehicle not found");
  }

  const now = utcNow();
  const activeSession = await prisma.telemetrySession.findFirst({
    where: {
      vehicleId,
      active: true,
      expiresAt: { gt: now },
    },
  });

  if (activeSession) {
    throw new AppError(409, "Vehicle already has an active telemetry session");
  }

  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
  const sessionId = randomUUID();

  await prisma.telemetrySession.create({
    data: {
      id: sessionId,
      vehicleId,
      issuedAt: now,
      expiresAt,
      active: true,
    },
  });

  return {
    token: await createVehicleJwt(vehicleId, sessionId, now, expiresAt),
    expires_at: expiresAt.toISOString(),
  };
}

export async function requireActiveSession(
  tx: Prisma.TransactionClient,
  vehicleId: string,
  sessionId: string,
) {
  const session = await tx.telemetrySession.findUnique({
    where: { id: sessionId },
  });
  const now = utcNow();

  if (
    !session ||
    session.vehicleId !== vehicleId ||
    !session.active ||
    session.expiresAt <= now
  ) {
    throw new AppError(401, "Telemetry session is not active");
  }

  return session;
}
