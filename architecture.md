# Fleet Telemetry Monitoring Service - Architecture

## Purpose

This project is a production-oriented Next.js implementation of a fleet telemetry
dashboard and ingestion API. It supports two complementary flows:

- Real telemetry ingestion from vehicles through JWT-protected sessions.
- A production demo simulator where the browser asks the backend to generate
  coalesced telemetry ticks and then refreshes the dashboard state.

The app is intentionally small, but the code is
structured around production concerns: runtime validation, transactional domain
logic, Postgres-backed rate limits, migrations, deterministic tests, and a clear
separation between API routes, domain services, persistence, and UI.

## System Context

```text
+-------------------+          +--------------------------+
| Reviewer Browser  |          | External Vehicle Client  |
| Dashboard UI      |          | or Local Simulator       |
+---------+---------+          +------------+-------------+
          |                                 |
          | GET /api/dashboard             | POST /auth/vehicle-token
          | POST /api/simulator/tick       | POST /telemetry
          |                                 |
          v                                 v
+---------------------------------------------------------+
| Next.js App Router                                      |
| Route Handlers + React Dashboard                        |
+----------------------+----------------------------------+
                       |
                       | Prisma Client + pg adapter
                       v
+---------------------------------------------------------+
| PostgreSQL                                              |
| vehicles, telemetry_events, anomalies, warnings,        |
| zone_counts, sessions, domain_event_logs, rate limits   |
+---------------------------------------------------------+
```

## Runtime Architecture

```text
+---------------------------------------------------------+
| src/app                                                 |
|                                                         |
|  page.tsx                                               |
|    -> FleetDashboard client component                   |
|                                                         |
|  api/dashboard/route.ts                                 |
|    -> dashboardSnapshot()                               |
|                                                         |
|  api/simulator/tick/route.ts                            |
|    -> validate input                                    |
|    -> enforce public API rate limit                     |
|    -> runCoalescedSimulationTick()                      |
|                                                         |
|  telemetry/route.ts                                     |
|    -> bearer token                                      |
|    -> validate telemetry payload                        |
|    -> persistTelemetry()                                |
|                                                         |
|  auth/vehicle-token/route.ts                            |
|    -> issueVehicleToken()                               |
+-------------------------+-------------------------------+
                          |
                          v
+---------------------------------------------------------+
| src/lib/domain                                          |
|                                                         |
|  auth.ts        JWT session issuing/verification        |
|  telemetry.ts   transactional telemetry persistence     |
|  anomaly.ts     anomaly detection rules                 |
|  dashboard.ts   dashboard read model aggregation        |
|  simulator.ts   production demo tick generation         |
|  rate-limit.ts  Postgres-backed rate limits             |
|  events.ts      domain event log writes                 |
|  validation.ts  Zod request validation                  |
+-------------------------+-------------------------------+
                          |
                          v
+---------------------------------------------------------+
| src/lib/db.ts + src/lib/env.ts                          |
| Lazy Prisma client + runtime environment validation     |
+-------------------------+-------------------------------+
                          |
                          v
+---------------------------------------------------------+
| PostgreSQL via Prisma 7                                 |
+---------------------------------------------------------+
```

## Key Components

| Area | Files | Responsibility |
| --- | --- | --- |
| Dashboard UI | `src/components/dashboard/fleet-dashboard.tsx` | Renders metrics, charts, filters, vehicles table, simulator status, and SWR refresh loop. |
| Dashboard BFF | `src/app/api/dashboard/route.ts`, `src/lib/domain/dashboard.ts` | Returns one aggregate payload for the UI: vehicles, fleet state, zone counts, anomalies, warnings. |
| Simulator API | `src/app/api/simulator/tick/route.ts`, `src/lib/domain/simulator.ts` | Public production demo tick endpoint with coalescing and rate limiting. |
| Telemetry API | `src/app/telemetry/route.ts`, `src/lib/domain/telemetry.ts` | Authenticates vehicle sessions and persists telemetry plus derived domain effects. |
| Vehicle Auth | `src/app/auth/vehicle-token/route.ts`, `src/lib/domain/auth.ts` | Issues one active telemetry session token per vehicle. |
| Domain Rules | `src/lib/domain/anomaly.ts`, `src/lib/constants.ts` | GPS jumps, battery drain spikes, status/speed conflict, repeated fault codes, stale telemetry, warnings. |
| Persistence | `prisma/schema.prisma`, `prisma/migrations/*`, `src/lib/db.ts` | Data model, migrations, and lazy Prisma client initialization. |
| Runtime Config | `src/lib/env.ts`, `.env.example`, `prisma.config.ts` | Validates required runtime variables and Prisma CLI configuration. |
| Tests | `tests/unit`, `tests/integration`, `tests/e2e` | Unit rules, DB-backed domain workflows, and browser smoke coverage. |

## Dashboard Demo Flow

The browser is part of the production demo. It asks the backend to advance the
simulation while a tab is visible, then reads the resulting state back through
the dashboard aggregate endpoint.

```text
+---------+                  +----------------------+                  +----------+
| Browser |                  | Next.js Backend      |                  | Postgres |
+----+----+                  +----------+-----------+                  +----+-----+
     |                                  |                                   |
     | GET /api/dashboard               |                                   |
     |--------------------------------->| dashboardSnapshot()               |
     |                                  |---------------------------------->| read model
     |                                  |<----------------------------------| rows
     |<---------------------------------| vehicles, charts, signals         |
     |                                  |                                   |
     | every 3s while tab is visible    |                                   |
     | POST /api/simulator/tick         |                                   |
     |--------------------------------->| validate body/query               |
     |                                  | enforceApiRateLimit()             |
     |                                  |---------------------------------->| api_rate_limit_hits
     |                                  | claim advisory lock + interval    |
     |                                  |---------------------------------->| domain_event_logs
     |                                  | runSimulationTick()               |
     |                                  |---------------------------------->| telemetry + effects
     |<---------------------------------| accepted or skipped               |
     |                                  |                                   |
     | if accepted: SWR mutate()        |                                   |
     | GET /api/dashboard               |                                   |
     |--------------------------------->| dashboardSnapshot()               |
     |                                  |---------------------------------->| updated read model
     |<---------------------------------| refreshed dashboard               |
+----+----+                  +----------+-----------+                  +----+-----+
```

Important behavior:

- Multiple open tabs are coalesced by an advisory lock and a domain event marker.
- Only one accepted simulator tick can run in the configured interval.
- Other tabs receive `skipped: true` and keep the UI alive without writing data.
- Public abuse is limited with a Postgres-backed IP/user-agent rate limit.

## Telemetry Ingestion Flow

```text
+---------+              +----------------------+              +----------+
| Vehicle |              | Next.js Backend      |              | Postgres |
+----+----+              +----------+-----------+              +----+-----+
     |                             |                                |
     | POST /auth/vehicle-token    |                                |
     |---------------------------->| validate vehicle_id            |
     |                             | check active session           |
     |                             |------------------------------->| telemetry_sessions
     |                             | create session + JWT           |
     |                             |------------------------------->| telemetry_sessions
     |<----------------------------| token, expires_at              |
     |                             |                                |
     | POST /telemetry Bearer JWT  |                                |
     |---------------------------->| validate JWT                   |
     |                             | validate telemetry payload     |
     |                             | open DB transaction            |
     |                             | enforce per-vehicle rate limit |
     |                             | lock vehicle row               |
     |                             | create telemetry event         |
     |                             | detect anomalies/warnings      |
     |                             | update vehicle current state   |
     |                             | update zones/missions/etc.     |
     |                             | write domain event logs        |
     |                             |------------------------------->| atomic commit
     |<----------------------------| telemetry_event_id, signals    |
+----+----+             +----------+-----------+               +----+-----+
```

Transactional guarantees:

- Telemetry event, derived anomalies, warnings, zone counts, mission updates,
  maintenance records, and domain event logs are committed together.
- Out-of-order telemetry is stored, but it does not overwrite current vehicle
  state when its timestamp is older than the current latest timestamp.
- Low battery is modeled as a warning, not an anomaly.

## Data Model

```text
Vehicle
  vehicle_id PK
  latest_timestamp
  status
  battery_pct
  speed_mps
  lat / lon
  active_mission_id
  stale_episode_open
      |
      | 1-to-many
      v
TelemetrySession
  id PK
  vehicle_id FK -> Vehicle.vehicle_id
  issued_at
  expires_at
  active
      |
      | 1-to-many
      v
TelemetryEvent
  id PK
  vehicle_id FK -> Vehicle.vehicle_id
  session_id FK -> TelemetrySession.id
  timestamp
  lat / lon
  battery_pct
  speed_mps
  status
  error_codes
  zone_entered
      |
      +---------------------+
      |                     |
      v                     v
Anomaly                WarningRecord
  telemetry_event_id     telemetry_event_id
  vehicle_id             vehicle_id
  type                   type
  severity               details
  details

Vehicle
  |
  +--> Mission
  |
  +--> MaintenanceRecord

ZoneCount
  zone_id PK
  entry_count

DomainEventLog
  event_type
  aggregate_id
  payload
  created_at

TelemetryRateLimitHit
  vehicle_id
  occurred_at

ApiRateLimitHit
  scope
  identifier
  occurred_at
```

## API Surface

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| `GET` | `/health` | Basic service health. | None |
| `GET` | `/api/dashboard` | Aggregate dashboard read model. | None |
| `POST` | `/api/simulator/tick` | Production demo simulator tick. | None, rate limited |
| `POST` | `/auth/vehicle-token` | Create telemetry JWT for a seeded vehicle. | None |
| `POST` | `/telemetry` | Ingest telemetry from a vehicle. | Bearer vehicle JWT |
| `GET` | `/vehicles` | List vehicle states. | None |
| `GET` | `/fleet/state` | Fleet state aggregate. | None |
| `GET` | `/anomalies` | Recent/filterable anomalies. | None |
| `GET` | `/warnings` | Recent/filterable warnings. | None |
| `GET` | `/zones/counts` | Zone entry counts. | None |

All API responses use `Cache-Control: no-store` because the dashboard is
operational and frequently changing.

## Domain Rules

```text
Telemetry payload
      |
      v
+-----------------------------+
| Validate vehicle/session    |
+-------------+---------------+
              |
              v
+-----------------------------+
| Persist telemetry event     |
+-------------+---------------+
              |
              v
+-----------------------------+
| Detect anomaly rules        |
| - GPS_JUMP                  |
| - BATTERY_DRAIN_SPIKE       |
| - STATUS_SPEED_CONFLICT     |
| - REPEATED_FAULT_CODES      |
| - STALE_TELEMETRY           |
+-------------+---------------+
              |
              v
+-----------------------------+
| Raise warnings              |
| - LOW_BATTERY_WARNING       |
+-------------+---------------+
              |
              v
+-----------------------------+
| Apply side effects          |
| - Zone count increment      |
| - Mission cancellation      |
| - Maintenance record        |
| - Vehicle state update      |
| - Domain event logs         |
+-----------------------------+
```

## Runtime Configuration

Runtime variables are validated in `src/lib/env.ts`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Runtime PostgreSQL connection string. |
| `DIRECT_URL` | Recommended | Direct/session URL for migrations. |
| `JWT_SECRET` | Yes | Vehicle JWT signing secret. Must be strong in production. |
| `JWT_ALGORITHM` | Optional | Currently `HS256`. |
| `STALE_AFTER_SECONDS` | Optional | Stale telemetry threshold, default `10`. |
| `SIMULATOR_TICK_RATE_LIMIT_REQUESTS` | Optional | Public tick requests per identity/window, default `120`. |
| `SIMULATOR_TICK_RATE_LIMIT_WINDOW_SECONDS` | Optional | Rate limit window, default `60`. |

## Production Notes

- The simulator is intentionally enabled in production for the demo. The backend,
  not the client, decides whether a tick is accepted or skipped.
- Public simulator writes are constrained by both a global coalescing lock and a
  per-client rate limit.
- `prisma migrate deploy` must run before the app uses a database, especially
  after adding `api_rate_limit_hits`.
- Prisma is lazily initialized so builds do not require live runtime services.
- The production deploy workflow validates required secrets before build/deploy.

## Testing Strategy

```text
npm run lint
  -> ESLint + Next.js rules

npm run typecheck
  -> TypeScript strict checks

npm run test:unit
  -> Pure domain/unit checks

npm run test:integration
  -> Prisma + Postgres domain workflow checks
  -> requires docker compose --profile test up -d postgres-test

npm run test:e2e
  -> Playwright smoke test
  -> starts this app on 127.0.0.1:3210 unless PLAYWRIGHT_BASE_URL is set

npm run build
  -> Production Next.js build
```

The integration suite covers token/session behavior, anomaly detection,
low-battery warnings, concurrent zone count increments, mission cancellation,
out-of-order telemetry, telemetry rate limiting, domain event logs, stale
episodes, fleet aggregation, dashboard snapshot, API rate limiting, and
coalesced simulator ticks.
