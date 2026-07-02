# Fleet Telemetry Monitoring Service - Next.js

Production-ready Next.js

## Stack

- Next.js App Router, React 19, TypeScript
- shadcn/ui, Tailwind CSS, Recharts, SWR
- Prisma ORM 7, PostgreSQL
- Docker Compose for local and test databases
- GitHub Actions deployment to Vercel with Prisma migrations

## Local Setup

```bash
npm install
cp .env.example .env.local
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://localhost:3000.

The local Postgres container binds host port `5434` to avoid colliding with other local Postgres services.

## Simulator

```bash
BACKEND_URL=http://localhost:3000 npm run simulate
```

The local simulator requests telemetry tokens for 50 vehicles and emits roughly 1 Hz telemetry with deterministic anomaly scenarios. It is a long-running process, so run it from your machine or an external worker, not inside Vercel.

## Dashboard-Driven Simulation on Vercel

The dashboard keeps the simulator active while at least one browser tab is open.
The client calls a serverless tick endpoint every 3 seconds:

```bash
curl -X POST "https://<your-vercel-domain>/api/simulator/tick"
```

Each accepted dashboard tick writes a small batch of telemetry events through the
same persistence, anomaly, warning, zone count, stale telemetry, and domain event
logic as the public telemetry API. The endpoint uses a Postgres advisory lock
and a `domain_event_logs` marker so multiple open tabs coalesce to at most one
accepted tick every 3 seconds. It also applies a Postgres-backed IP/user-agent
rate limit so the public demo remains available without login.

The dashboard reads operational state from `GET /api/dashboard`, a single
aggregate endpoint that returns vehicles, fleet state, zone counts, recent
anomalies, and recent warnings. After an accepted simulator tick, the client
revalidates that endpoint so reviewers can see the backend changes flow back
into the UI.

If no dashboard tab is active, no serverless simulator work runs. For continuous
1 Hz telemetry, run the long-lived local simulator from an external machine
against the production URL.

## Tests

Unit tests do not require Postgres:

```bash
npm run test:unit
```

Integration tests require the test database:

```bash
docker compose --profile test up -d postgres-test
DATABASE_URL=postgresql://fleet:fleet@localhost:5433/fleet_test?schema=public \
DIRECT_URL=postgresql://fleet:fleet@localhost:5433/fleet_test?schema=public \
JWT_SECRET=test-secret \
npm run test:integration
```

Playwright starts this app on `127.0.0.1:3210` by default so it does not collide
with other local projects. Override with `PLAYWRIGHT_BASE_URL` when testing an
already-running deployment.

## Supabase/Vercel Environment

For Vercel serverless deployments with Supabase:

- `DATABASE_URL`: Supavisor transaction pooler URL, port `6543`, with `pgbouncer=true`
- `DIRECT_URL`: Supavisor session pooler URL, port `5432`, for migrations
- `JWT_SECRET`: strong production secret
- `JWT_ALGORITHM`: `HS256`
- `STALE_AFTER_SECONDS`: default `10`
- `SIMULATOR_TICK_RATE_LIMIT_REQUESTS`: default `120`
- `SIMULATOR_TICK_RATE_LIMIT_WINDOW_SECONDS`: default `60`

Supabase pooler example:

```env
DATABASE_URL="postgresql://postgres.<project-ref>:<password>@aws-1-us-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.<project-ref>:<password>@aws-1-us-west-1.pooler.supabase.com:5432/postgres"
```

If you only have the direct Supabase URL, set both `DATABASE_URL` and `DIRECT_URL` to it with `sslmode=require`. The direct URL can be IPv6-only; GitHub/Vercel deployments are usually better served by Supavisor pooler URLs.

Set GitHub repository secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `DATABASE_URL`
- `DIRECT_URL`
- `JWT_SECRET`

The production workflow runs `prisma migrate deploy`, ensures idempotent
reference data for vehicles/zones, then runs `vercel build` and
`vercel deploy --prebuilt --prod`.
