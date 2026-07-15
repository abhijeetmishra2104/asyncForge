import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma"; // Use the shared instance

export async function GET(req: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const job = await prisma.job.findUnique({
      where: { id: params.jobId },
      select: {
        id: true,
        status: true,
        output: true,
        error: true,
        attempts: true,
        createdAt: true,
        startedAt: true,
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json(job, { status: 200 });
  } catch (error) {
    console.error("[API Status] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}