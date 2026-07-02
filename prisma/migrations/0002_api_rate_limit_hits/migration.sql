CREATE TABLE "api_rate_limit_hits" (
  "id" BIGSERIAL PRIMARY KEY,
  "scope" VARCHAR(64) NOT NULL,
  "identifier" VARCHAR(96) NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "ix_api_rate_limit_scope_identifier_time"
  ON "api_rate_limit_hits"("scope", "identifier", "occurred_at");

CREATE INDEX "ix_api_rate_limit_occurred_at"
  ON "api_rate_limit_hits"("occurred_at");
