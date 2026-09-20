import { inject } from "vitest";

/**
 * Runs before each test file, before any application module is imported, so
 * lib/env.ts parses these values rather than whatever is in the developer's
 * .env. dotenv never overrides a variable that is already set.
 *
 * Every variable the app reads is set explicitly. Leaving one out would let a
 * real value from .env leak in — including the production DATABASE_URL.
 */
const databaseUrl = inject("databaseUrl");

// Hard stop. Tests TRUNCATE tables; they must never be able to reach a real
// database, whatever the environment looks like.
const host = new URL(databaseUrl).hostname;
if (host !== "localhost" && host !== "127.0.0.1") {
  throw new Error(`Refusing to run tests against non-local database host "${host}".`);
}

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: databaseUrl,
  RABBITMQ_URL: inject("rabbitUrl"),
  // Both keys are set so either provider can be selected in a test; the
  // fake model means neither is ever used to make a call.
  AI_PROVIDER: "claude",
  ANTHROPIC_API_KEY: "test-key-never-sent",
  ANTHROPIC_MODEL: "claude-opus-5",
  GEMINI_API_KEY: "test-key-never-sent",
  GEMINI_MODEL: "fake-model",
  MAX_JOB_ATTEMPTS: "3",
  RABBITMQ_PREFETCH: "1",
  RABBITMQ_QUEUE_TYPE: "quorum",
  // Production backs off 5s → 60s. Same shape, compressed so retries take
  // milliseconds instead of minutes.
  RETRY_BASE_DELAY_MS: "100",
  RETRY_MAX_DELAY_MS: "800",
  JOB_PROCESSING_TIMEOUT_MS: "60000",
  GEMINI_TIMEOUT_MS: "5000",
  OUTBOX_POLL_INTERVAL_MS: "20",
  OUTBOX_BATCH_SIZE: "20",
  OUTBOX_CLAIM_TIMEOUT_MS: "1500",
  ANALYZE_RATE_LIMIT: "5",
  // Above the 20-task burst in pipeline.test.ts, so only the test that
  // targets the ceiling actually reaches it.
  GLOBAL_ANALYZE_LIMIT: "25",
  DEVICE_REGISTER_RATE_LIMIT: "1000",
});
