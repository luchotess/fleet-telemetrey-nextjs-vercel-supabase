import { z } from "zod";

const postgresUrlSchema = z
  .string()
  .min(1)
  .refine((value) => /^postgres(ql)?:\/\//.test(value), {
    message: "must be a PostgreSQL connection string",
  });

const envSchema = z.object({
  DATABASE_URL: postgresUrlSchema,
  DIRECT_URL: postgresUrlSchema.optional(),
  JWT_SECRET: z.string().min(1),
  JWT_ALGORITHM: z.enum(["HS256"]).default("HS256"),
  STALE_AFTER_SECONDS: z.coerce.number().int().positive().default(10),
  SIMULATOR_TICK_RATE_LIMIT_REQUESTS: z.coerce
    .number()
    .int()
    .positive()
    .default(120),
  SIMULATOR_TICK_RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

function formatIssues(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
    .join("; ");
}

function assertProductionSecret(env: AppEnv) {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  if (
    env.JWT_SECRET === "development-only-secret" ||
    env.JWT_SECRET === "test-secret" ||
    env.JWT_SECRET.length < 32
  ) {
    throw new Error(
      "Invalid runtime environment: JWT_SECRET must be a strong production secret.",
    );
  }
}

export function getAppEnv() {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid runtime environment: ${formatIssues(parsed.error)}`);
  }

  assertProductionSecret(parsed.data);
  cachedEnv = parsed.data;
  return cachedEnv;
}

export function resetAppEnvForTests() {
  cachedEnv = null;
}
