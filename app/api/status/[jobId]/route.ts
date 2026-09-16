import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDevice } from "@/lib/auth";
import { MAX_JOB_ATTEMPTS } from "@/lib/api-limits";

export async function GET(req: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const device = await authenticateDevice(req);
    if (!device) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
      );
    }

    // Scoped by owner, so a job belonging to someone else is indistinguishable
    // from one that does not exist. Jobs created before authentication have a
    // null deviceId and are therefore unreachable, which is intended.
    const job = await prisma.job.findFirst({
      where: { id: params.jobId, deviceId: device.id },
      select: {
        id: true,
        status: true,
        output: true,
        error: true,
        attempts: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // maxAttempts lets the client render "Attempt 2 of 3" while a job is
    // being retried, instead of a bare number with no ceiling to read it against.
    return NextResponse.json({ ...job, maxAttempts: MAX_JOB_ATTEMPTS }, { status: 200 });
  } catch (error) {
    console.error("[API Status] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
