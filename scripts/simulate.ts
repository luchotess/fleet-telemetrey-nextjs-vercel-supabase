import { setTimeout as sleep } from "node:timers/promises";
import { ZONES } from "../src/lib/constants";

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:3000";
const vehicleIds = Array.from({ length: 50 }, (_, index) => `v-${index + 1}`);

interface VehicleSimState {
  vehicleId: string;
  token: string | null;
  expiresAt: Date | null;
  lat: number;
  lon: number;
  batteryPct: number;
  status: string;
  repeatedFaultCode: string | null;
  repeatedFaultRemaining: number;
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number) {
  return Math.floor(randomBetween(min, max + 1));
}

function choice<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

async function waitForBackend() {
  while (true) {
    try {
      const response = await fetch(`${backendUrl}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    console.log("waiting for backend...");
    await sleep(2_000);
  }
}

async function ensureToken(state: VehicleSimState) {
  const now = new Date();
  if (
    state.token &&
    state.expiresAt &&
    state.expiresAt.getTime() - now.getTime() > 2 * 60 * 1000
  ) {
    return;
  }

  const response = await fetch(`${backendUrl}/auth/vehicle-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vehicle_id: state.vehicleId }),
  });

  if (response.status === 409 && state.token) {
    return;
  }

  if (!response.ok) {
    throw new Error(`${state.vehicleId}: token request failed ${response.status}`);
  }

  const body = (await response.json()) as { token: string; expires_at: string };
  state.token = body.token;
  state.expiresAt = new Date(body.expires_at);
}

function chooseStatus(state: VehicleSimState) {
  if (Math.random() < 0.015) return "fault";
  if (state.batteryPct < 18 && Math.random() < 0.35) return "charging";
  const roll = Math.random();
  if (roll < 0.68) return "moving";
  if (roll < 0.9) return "idle";
  return "charging";
}

function buildPayload(state: VehicleSimState) {
  let status = chooseStatus(state);
  let speedMps = 0;

  if (status === "moving") {
    speedMps = randomBetween(0.6, 2.2);
    state.lat += randomBetween(-0.000025, 0.000025);
    state.lon += randomBetween(-0.000025, 0.000025);
  } else if (status === "charging") {
    state.batteryPct = Math.min(100, state.batteryPct + randomInt(0, 2));
  }

  if (Math.random() < 0.02) {
    state.lat += randomBetween(0.004, 0.008);
    state.lon += randomBetween(0.004, 0.008);
  }

  if (Math.random() < 0.025) {
    status = choice(["idle", "charging"] as const);
    speedMps = randomBetween(0.8, 2);
  }

  if (Math.random() < 0.025) {
    state.batteryPct = Math.max(0, state.batteryPct - randomInt(11, 18));
  } else if (status !== "charging") {
    state.batteryPct = Math.max(0, state.batteryPct - choice([0, 0, 1] as const));
  }

  if (Math.random() < 0.02) {
    state.batteryPct = randomInt(5, 14);
  }

  const errorCodes: string[] = [];
  if (state.repeatedFaultRemaining <= 0 && Math.random() < 0.025) {
    state.repeatedFaultCode = choice(["E_DRIVE", "E_BRAKE", "E_SENSOR"] as const);
    state.repeatedFaultRemaining = 3;
  }
  if (state.repeatedFaultRemaining > 0 && state.repeatedFaultCode) {
    errorCodes.push(state.repeatedFaultCode);
    state.repeatedFaultRemaining -= 1;
  }
  if (status === "fault" && errorCodes.length === 0) {
    errorCodes.push(choice(["F_MOTOR", "F_BATTERY", "F_NAV"] as const));
  }

  state.status = status;
  return {
    vehicle_id: state.vehicleId,
    timestamp: new Date().toISOString(),
    lat: Number(state.lat.toFixed(6)),
    lon: Number(state.lon.toFixed(6)),
    battery_pct: state.batteryPct,
    speed_mps: Number(speedMps.toFixed(2)),
    status,
    error_codes: errorCodes,
    zone_entered: Math.random() < 0.08 ? choice(ZONES) : null,
  };
}

async function vehicleLoop(state: VehicleSimState) {
  while (true) {
    try {
      if (Math.random() < 0.015) {
        await sleep(randomBetween(12_000, 18_000));
      }

      await ensureToken(state);
      const response = await fetch(`${backendUrl}/telemetry`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${state.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildPayload(state)),
      });

      if (response.status === 401) {
        state.token = null;
        state.expiresAt = null;
      } else if (response.status === 429) {
        await sleep(1_500);
      } else if (!response.ok) {
        throw new Error(`${state.vehicleId}: telemetry failed ${response.status}`);
      }
    } catch (error) {
      console.error(error);
      await sleep(2_000);
    }

    await sleep(randomBetween(850, 1_150));
  }
}

async function main() {
  await waitForBackend();
  const states: VehicleSimState[] = vehicleIds.map((vehicleId) => ({
    vehicleId,
    token: null,
    expiresAt: null,
    lat: 37.41 + Math.random() * 0.01,
    lon: -122.08 + Math.random() * 0.01,
    batteryPct: randomInt(35, 95),
    status: "idle",
    repeatedFaultCode: null,
    repeatedFaultRemaining: 0,
  }));

  console.log(`starting simulator for ${states.length} vehicles against ${backendUrl}`);
  await Promise.all(states.map(vehicleLoop));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
