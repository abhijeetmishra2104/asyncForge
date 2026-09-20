import { z } from "zod";
import { config } from "dotenv";

// Load environment variables from the .env file into process.env
config();

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  RABBITMQ_URL: z.string().url(),
  // Which model provider runs. Switching is a config change, not a code change.
  AI_PROVIDER: z.enum(["claude", "gemini"]).default("claude"),
  // Each key is required only when its provider is the active one — enforced
  // below, so a Claude deployment needs no Gemini key and vice versa.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-haiku-4-5"),
  // Optional on purpose: effort is only accepted by some models. Opus 4.5+ and
  // Sonnet 5 take it; Haiku 4.5 returns a 400 if it is sent at all. Leave unset
  // for Haiku, set "low" when running a model that supports it.
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
  MAX_JOB_ATTEMPTS: z.coerce.number().default(3),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().default(1000),
  OUTBOX_BATCH_SIZE: z.coerce.number().default(20),
  // How long a dispatcher owns a claimed batch. Must comfortably exceed the
  // time to publish one batch; a claim older than this is presumed abandoned.
  OUTBOX_CLAIM_TIMEOUT_MS: z.coerce.number().default(30000),
  RABBITMQ_PREFETCH: z.coerce.number().default(1),
  // Quorum queues need a broker that allows them. Some managed shared brokers
  // (e.g. CloudAMQP's free tier) may reject them, so this is switchable
  // without a code change.
  RABBITMQ_QUEUE_TYPE: z.enum(["quorum", "classic"]).default("quorum"),
  // First retry delay; each further attempt doubles it. Gemini's 503s are
  // transient and usually clear immediately, so waiting 5s was mostly dead
  // time: a job that failed twice spent 15s of its life in backoff alone.
  // Rate limiting (429) is handled separately — see worker/processor.ts.
  RETRY_BASE_DELAY_MS: z.coerce.number().default(1000),
  RETRY_MAX_DELAY_MS: z.coerce.number().default(60000),
  // Upper bound on a single model call. Without one, a hung request holds its
  // worker slot and its lease indefinitely: the slowest job on record took 340s.
  GEMINI_TIMEOUT_MS: z.coerce.number().default(45000),
  // How long a PROCESSING job stays owned by the worker that took it. Must
  // exceed the longest a job can run (GEMINI_TIMEOUT_MS plus a little), or two
  // workers could process the same job at once. Lower is better otherwise:
  // it bounds how long a job waits after a worker dies without releasing it.
  JOB_PROCESSING_TIMEOUT_MS: z.coerce.number().default(120000),
  WORKER_HEALTH_PORT: z.coerce.number().default(8081),
  DISPATCHER_HEALTH_PORT: z.coerce.number().default(8082),
});

const withProviderKey = envSchema.superRefine((value, ctx) => {
  const required =
    value.AI_PROVIDER === "claude" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";

  if (!value[required]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [required],
      message: `${required} is required when AI_PROVIDER is "${value.AI_PROVIDER}".`,
    });
  }
});

const _env = withProviderKey.safeParse(process.env);

if (!_env.success) {
  console.error("❌ Invalid environment variables:", _env.error.format());
  process.exit(1);
}

export const env = _env.data;