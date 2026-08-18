import { createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import { prisma } from "./prisma";

/**
 * Anonymous device authentication.
 *
 * There are no user accounts. A client (the mobile app, or a browser) registers
 * itself once against POST /api/devices, receives a bearer token, and stores it
 * locally. The token identifies an install, not a person.
 *
 * The token is returned exactly once and only its SHA-256 hash is persisted, so
 * a database leak does not hand out working credentials. Lookup is by hash on a
 * unique index, so there is no secret-to-secret comparison to time.
 */

const TOKEN_PREFIX = "af_";
const TOKEN_BYTES = 32;

/** Refresh lastSeenAt at most this often, to keep reads from causing a write. */
const LAST_SEEN_REFRESH_MS = 60 * 60 * 1000;

export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type AuthedDevice = { id: string };

export function readBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;

  const separator = header.indexOf(" ");
  if (separator === -1) return null;

  const scheme = header.slice(0, separator);
  const value = header.slice(separator + 1).trim();
  if (scheme.toLowerCase() !== "bearer" || !value) return null;

  return value;
}

/** Returns the calling device, or null if the token is missing or unknown. */
export async function authenticateDevice(
  req: NextRequest
): Promise<AuthedDevice | null> {
  const token = readBearerToken(req);
  if (!token) return null;

  const device = await prisma.device.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, lastSeenAt: true },
  });
  if (!device) return null;

  if (Date.now() - device.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
    await prisma.device.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    });
  }

  return { id: device.id };
}

/**
 * Best-effort client address for per-IP limits. Behind the NGINX ingress the
 * real address arrives in X-Forwarded-For; the left-most entry is the client.
 * This is spoofable when the app is exposed without a trusted proxy, so it is
 * only used to slow down bulk device registration, never for authorization.
 */
export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || req.ip || "unknown";
}
