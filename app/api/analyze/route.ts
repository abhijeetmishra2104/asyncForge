import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../lib/prisma"; // Use the shared instance

const analyzeRequestSchema = z.object({
  prompt: z.string().min(10).max(10000),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = analyzeRequestSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json({ error: "Invalid prompt", details: result.error.errors }, { status: 400 });
    }

    const { prompt } = result.data;

    // Transactional Outbox Pattern
    const job = await prisma.$transaction(async (tx) => {
      const newJob = await tx.job.create({
        data: { prompt, status: "QUEUED" },
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

    return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
  } catch (error) {
    console.error("[API Analyze] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}