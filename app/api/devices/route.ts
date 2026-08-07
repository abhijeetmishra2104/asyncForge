import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { clientIp, generateToken, hashToken } from "@/lib/auth";
import { REGISTER_LIMIT, REGISTER_WINDOW_MS } from "@/lib/api-limits";
import { consumeRateLimit, rateLimitHeaders } from "@/lib/rate-limit";

const registerSchema = z.object({
  platform: z.enum(["ios", "android", "web"]).optional(),
});

/**
 * POST /api/devices — register an anonymous client and mint its bearer token.
 *
 * The token is returned here and never again; clients persist it themselves
 * (SecureStore on mobile, localStorage in the browser).
 */
export async function POST(req: NextRequest) {
  try {
    const limit = await consumeRateLimit(
      `register:ip:${clientIp(req)}`,
      REGISTER_LIMIT,
      REGISTER_WINDOW_MS
    );

    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many device registrations. Try again later." },
        {
          status: 429,
          headers: {
            ...rateLimitHeaders(limit),
            "Retry-After": String(limit.retryAfterSeconds),
          },
        }
      );
    }

    // The body is optional; platform is only a diagnostic label.
    let platform: "ios" | "android" | "web" | undefined;
    try {
      const parsed = registerSchema.safeParse(await req.json());
      if (parsed.success) platform = parsed.data.platform;
    } catch {
      // No body, or not JSON. Register anyway.
    }

    const token = generateToken();
    const device = await prisma.device.create({
      data: { tokenHash: hashToken(token), platform },
      select: { id: true },
    });

    return NextResponse.json(
      { deviceId: device.id, token },
      { status: 201, headers: rateLimitHeaders(limit) }
    );
  } catch (error) {
    console.error("[API Devices] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
