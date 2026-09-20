/**
 * Request limits for the public API.
 *
 * These read process.env directly rather than going through lib/env.ts on
 * purpose: that module also requires RABBITMQ_URL and GEMINI_API_KEY and calls
 * process.exit(1) when they are missing, which is correct for the worker and
 * dispatcher but wrong for a web request path.
 */
function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const HOUR_MS = 60 * 60 * 1000;

/** Jobs a single device may submit per window. Each one costs a Gemini call. */
export const ANALYZE_LIMIT = positiveInt("ANALYZE_RATE_LIMIT", 20);
export const ANALYZE_WINDOW_MS = positiveInt("ANALYZE_RATE_WINDOW_MS", HOUR_MS);

/**
 * A ceiling across everyone, not per device. The per-device limit is about
 * fairness; this one protects the Gemini quota, which is shared and finite:
 * a few keen visitors registering fresh devices would otherwise exhaust the
 * day's budget and leave every later visitor staring at failures.
 */
export const GLOBAL_ANALYZE_LIMIT = positiveInt("GLOBAL_ANALYZE_LIMIT", 150);
export const GLOBAL_ANALYZE_WINDOW_MS = positiveInt(
  "GLOBAL_ANALYZE_WINDOW_MS",
  24 * HOUR_MS
);

/**
 * Registrations allowed per client address per window. Without this, the
 * per-device limit above would be trivially bypassed by registering a fresh
 * device for every request.
 */
export const REGISTER_LIMIT = positiveInt("DEVICE_REGISTER_RATE_LIMIT", 10);
export const REGISTER_WINDOW_MS = positiveInt(
  "DEVICE_REGISTER_RATE_WINDOW_MS",
  HOUR_MS
);

/**
 * Mirrors the worker's retry ceiling so the status API can report how many
 * attempts a job gets. lib/env.ts owns the value the worker actually enforces;
 * this only reports it, which is why the default must stay in step with it.
 */
export const MAX_JOB_ATTEMPTS = positiveInt("MAX_JOB_ATTEMPTS", 3);
