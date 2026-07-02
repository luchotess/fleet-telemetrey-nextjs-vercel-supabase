CREATE TABLE "vehicles" (
  "vehicle_id" VARCHAR(32) PRIMARY KEY,
  "latest_timestamp" TIMESTAMPTZ,
  "status" VARCHAR(32) NOT NULL DEFAULT 'idle',
  "battery_pct" INTEGER,
  "speed_mps" DOUBLE PRECISION,
  "lat" DOUBLE PRECISION,
  "lon" DOUBLE PRECISION,
  "active_mission_id" INTEGER,
  "stale_episode_open" BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE "telemetry_sessions" (
  "id" VARCHAR(36) PRIMARY KEY,
  "vehicle_id" VARCHAR(32) NOT NULL REFERENCES "vehicles"("vehicle_id"),
  "issued_at" TIMESTAMPTZ NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "ix_telemetry_sessions_vehicle_id" ON "telemetry_sessions"("vehicle_id");
CREATE INDEX "ix_telemetry_sessions_expires_at" ON "telemetry_sessions"("expires_at");

CREATE TABLE "telemetry_events" (
  "id" SERIAL PRIMARY KEY,
  "vehicle_id" VARCHAR(32) NOT NULL REFERENCES "vehicles"("vehicle_id"),
  "session_id" VARCHAR(36) NOT NULL REFERENCES "telemetry_sessions"("id"),
  "timestamp" TIMESTAMPTZ NOT NULL,
  "lat" DOUBLE PRECISION NOT NULL,
  "lon" DOUBLE PRECISION NOT NULL,
  "battery_pct" INTEGER NOT NULL,
  "speed_mps" DOUBLE PRECISION NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "error_codes" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "zone_entered" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "ix_telemetry_events_vehicle_id" ON "telemetry_events"("vehicle_id");
CREATE INDEX "ix_telemetry_events_session_id" ON "telemetry_events"("session_id");
CREATE INDEX "ix_telemetry_events_timestamp" ON "telemetry_events"("timestamp");

CREATE TABLE "anomalies" (
  "id" SERIAL PRIMARY KEY,
  "vehicle_id" VARCHAR(32) NOT NULL REFERENCES "vehicles"("vehicle_id"),
  "telemetry_event_id" INTEGER REFERENCES "telemetry_events"("id"),
  "type" VARCHAR(64) NOT NULL,
  "severity" VARCHAR(16) NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL,
  "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "ix_anomalies_vehicle_id" ON "anomalies"("vehicle_id");
CREATE INDEX "ix_anomalies_type" ON "anomalies"("type");
CREATE INDEX "ix_anomalies_timestamp" ON "anomalies"("timestamp");

CREATE TABLE "warnings" (
  "id" SERIAL PRIMARY KEY,
  "vehicle_id" VARCHAR(32) NOT NULL REFERENCES "vehicles"("vehicle_id"),
  "telemetry_event_id" INTEGER REFERENCES "telemetry_events"("id"),
  "type" VARCHAR(64) NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL,
  "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "ix_warnings_vehicle_id" ON "warnings"("vehicle_id");
CREATE INDEX "ix_warnings_type" ON "warnings"("type");
CREATE INDEX "ix_warnings_timestamp" ON "warnings"("timestamp");

CREATE TABLE "zone_counts" (
  "zone_id" VARCHAR(64) PRIMARY KEY,
  "entry_count" BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE "missions" (
  "id" SERIAL PRIMARY KEY,
  "vehicle_id" VARCHAR(32) NOT NULL REFERENCES "vehicles"("vehicle_id"),
  "status" VARCHAR(32) NOT NULL DEFAULT 'active',
  "cancelled_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "ix_missions_vehicle_id" ON "missions"("vehicle_id");

CREATE TABLE "maintenance_records" (
  "id" SERIAL PRIMARY KEY,
  "vehicle_id" VARCHAR(32) NOT NULL REFERENCES "vehicles"("vehicle_id"),
  "telemetry_event_id" INTEGER REFERENCES "telemetry_events"("id"),
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "ix_maintenance_records_vehicle_id" ON "maintenance_records"("vehicle_id");

CREATE TABLE "domain_event_logs" (
  "id" SERIAL PRIMARY KEY,
  "event_type" VARCHAR(64) NOT NULL,
  "aggregate_id" VARCHAR(64),
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "ix_domain_event_logs_event_type" ON "domain_event_logs"("event_type");
CREATE INDEX "ix_domain_event_logs_aggregate_id" ON "domain_event_logs"("aggregate_id");

CREATE TABLE "telemetry_rate_limit_hits" (
  "id" BIGSERIAL PRIMARY KEY,
  "vehicle_id" VARCHAR(32) NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "ix_rate_limit_hits_vehicle_time" ON "telemetry_rate_limit_hits"("vehicle_id", "occurred_at");
CREATE INDEX "ix_rate_limit_hits_occurred_at" ON "telemetry_rate_limit_hits"("occurred_at");
