import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticateDevice } from "@/lib/auth";
import { ANALYZE_LIMIT, ANALYZE_WINDOW_MS } from "@/lib/api-limits";
import { consumeRateLimit, rateLimitHeaders } from "@/lib/rate-limit";

const analyzeRequestSchema = z.object({
  prompt: z.string().min(10).max(10000),
});

export async function POST(req: NextRequest) {
  try {
    // Every accepted job costs a Gemini call, so this endpoint is authenticated
    // and metered. Clients register once via POST /api/devices.
    const device = await authenticateDevice(req);
    if (!device) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
      );
    }

    const limit = await consumeRateLimit(
      `analyze:device:${device.id}`,
      ANALYZE_LIMIT,
      ANALYZE_WINDOW_MS
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again later." },
        {
          status: 429,
          headers: {
            ...rateLimitHeaders(limit),
            "Retry-After": String(limit.retryAfterSeconds),
          },
        }
      );
    }

    const body = await req.json();
    const result = analyzeRequestSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json({ error: "Invalid prompt", details: result.error.errors }, { status: 400 });
    }

    const { prompt } = result.data;

    // Transactional Outbox Pattern
    const job = await prisma.$transaction(async (tx) => {
      const newJob = await tx.job.create({
        data: { prompt, status: "QUEUED", deviceId: device.id },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateId: newJob.id,
          eventType: "AI_TASK_CREATED",
          payload: { jobId: newJob.id },
        },
      });

      return newJob;
    }, {
      maxWait: 5000, // Give Neon 5 seconds to provide a connection
      timeout: 10000 // Allow the transaction up to 10 seconds to finish
    });

    return NextResponse.json(
      { jobId: job.id, status: job.status },
      { status: 202, headers: rateLimitHeaders(limit) }
    );
  } catch (error) {
    console.error("[API Analyze] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
