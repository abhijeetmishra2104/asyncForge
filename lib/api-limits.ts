/**
 * Request limits for the public API.
 *
 * These read process.env directly rather than going through lib/env.ts on
 * purpose: that module also requires RABBITMQ_URL and GROQ_API_KEY and calls
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

/** Jobs a single device may submit per window. Each one costs a Groq call. */
export const ANALYZE_LIMIT = positiveInt("ANALYZE_RATE_LIMIT", 20);
export const ANALYZE_WINDOW_MS = positiveInt("ANALYZE_RATE_WINDOW_MS", HOUR_MS);

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
