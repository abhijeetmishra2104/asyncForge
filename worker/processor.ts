import { prisma } from "../lib/prisma";
import { executeAITask } from "../lib/groq";
import { env } from "../lib/env";


export async function processJob(jobId: string, attempt: number) {
  // Idempotent Job Acquisition: Only acquire if QUEUED or PROCESSING lease expired
  const lockAcquired = await prisma.$executeRaw`
    UPDATE "Job"
    SET status = 'PROCESSING', 
        attempts = attempts + 1, 
        "startedAt" = COALESCE("startedAt", NOW()),
        "updatedAt" = NOW()
    WHERE id = ${jobId} AND (
      status = 'QUEUED' OR 
      (status = 'PROCESSING' AND "updatedAt" < NOW() - INTERVAL '5 minutes')
    )
  `;

  if (lockAcquired === 0) {
    // Determine if it was already COMPLETED or FAILED to ACK the duplicate
    const existingJob = await prisma.job.findUnique({ where: { id: jobId } });
    if (!existingJob) throw new Error(`Job ${jobId} not found`);
    if (existingJob.status === "COMPLETED" || existingJob.status === "FAILED") {
      console.log(`[Worker] Job ${jobId} already terminal (${existingJob.status}). Bypassing.`);
      return; 
    }
    throw new Error(`Job ${jobId} currently processing by another worker.`);
  }

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Job disappeared after lock");

  console.log(`[Worker] Processing Job ${jobId} (Attempt ${job.attempts})`);

  try {
    const aiResult = await executeAITask(job.prompt);
    
    // Complete the job durably before ACK
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        output: aiResult,
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    console.log(`[Worker] Job ${jobId} COMPLETED successfully.`);

  } catch (error) {
    console.error(`[Worker] Job ${jobId} execution failed:`, error);
    
    const isRetryable = job.attempts < env.MAX_JOB_ATTEMPTS;
    const errorMessage = error instanceof Error ? error.message : "Unknown AI Processing Error";

    if (isRetryable) {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: "QUEUED", error: errorMessage, updatedAt: new Date() },
      });
      throw new RetryableError("Temporary processing failure");
    } else {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: "FAILED", error: errorMessage, completedAt: new Date(), updatedAt: new Date() },
      });
      throw new FatalError("Maximum retries exhausted");
    }
  }
}

export class RetryableError extends Error {}
export class FatalError extends Error {}