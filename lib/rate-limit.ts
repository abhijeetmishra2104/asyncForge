import { prisma } from "./prisma";

/**
 * Fixed-window rate limiting backed by PostgreSQL.
 *
 * Postgres is already a hard dependency and every limit here is low-frequency,
 * so this avoids adding Redis purely for counters. Windows are aligned to
 * absolute boundaries (floor(now / windowMs)) so every replica computes the
 * same window without coordinating.
 *
 * The increment is a single INSERT ... ON CONFLICT DO UPDATE, which is atomic
 * under concurrency — several web replicas racing on the same key cannot lose
 * counts the way a read-then-write would.
 */

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
};

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);

  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count")
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimit"."windowStart" < ${windowStart} THEN 1
        ELSE "RateLimit"."count" + 1
      END,
      "windowStart" = CASE
        WHEN "RateLimit"."windowStart" < ${windowStart} THEN ${windowStart}
        ELSE "RateLimit"."windowStart"
      END
    RETURNING "count";
  `;

  // Requests past the limit still increment the counter. That is deliberate:
  // a client that keeps hammering stays locked out for the rest of the window.
  const count = Number(rows[0]?.count ?? 0);
  const resetAt = new Date(windowStart.getTime() + windowMs);

  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((resetAt.getTime() - Date.now()) / 1000)
    ),
  };
}

/** Standard rate-limit response headers, for both allowed and rejected calls. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(result.retryAfterSeconds),
  };
}
