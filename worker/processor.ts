import { prisma } from "../lib/prisma";
import {
  activeModel,
  activeProvider,
  executeAITask,
  type AIResponse,
} from "../lib/ai";
import { env } from "../lib/env";
import { jobsProcessedCounter, jobDurationHistogram } from "../lib/metrics";

/**
 * Everything processJob reaches outside itself for. Production passes nothing
 * and gets Gemini plus the configured limits; tests substitute a fake model and
 * short timings so crash and retry paths run in seconds instead of minutes.
 */
export type ProcessDeps = {
  executeAI?: (prompt: string) => Promise<AIResponse>;
  /** How long a PROCESSING job is owned by its worker before another may take it. */
  leaseMs?: number;
  maxAttempts?: number;
  /** Upper bound on one model call. */
  timeoutMs?: number;
};

/**
 * Rejects the model calls currently in flight. Each one fails as a retryable
 * error, so its job goes back to QUEUED and its message is redelivered at once.
 *
 * Without this, a worker that is shut down — a Spot reclaim, a rollout — leaves
 * its jobs PROCESSING, and nothing else may touch them until the lease expires.
 */
const inFlight = new Set<(reason: Error) => void>();

export function abortInFlightJobs() {
  const interrupt = [...inFlight];
  inFlight.clear();
  for (const reject of interrupt) reject(new RetryableError("Worker is shutting down."));
}

/**
 * Fails `work` if it outlives `timeoutMs`, or as soon as the worker is shutting
 * down. The underlying HTTP request cannot be cancelled, so it may still finish
 * in the background; by then this job has already taken the retry path.
 */
function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let interrupt!: (reason: Error) => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    interrupt = reject;
  });

  const timer = setTimeout(
    () => interrupt(new RetryableError(`Model call exceeded ${timeoutMs}ms.`)),
    timeoutMs
  );
  inFlight.add(interrupt);

  return Promise.race([work, interrupted]).finally(() => {
    clearTimeout(timer);
    inFlight.delete(interrupt);
  });
}

export async function processJob(jobId: string, deps: ProcessDeps = {}) {
  const executeAI = deps.executeAI ?? executeAITask;
  const leaseMs = deps.leaseMs ?? env.JOB_PROCESSING_TIMEOUT_MS;
  const maxAttempts = deps.maxAttempts ?? env.MAX_JOB_ATTEMPTS;
  const timeoutMs = deps.timeoutMs ?? env.GEMINI_TIMEOUT_MS;

  // Idempotent Job Acquisition: Only acquire if QUEUED or PROCESSING lease expired
  const lockAcquired = await prisma.$executeRaw`
    UPDATE "Job"
    SET status = 'PROCESSING', 
        attempts = attempts + 1, 
        "startedAt" = COALESCE("startedAt", NOW()),
        "updatedAt" = NOW()
    WHERE id = ${jobId} AND (
      status = 'QUEUED' OR 
      (status = 'PROCESSING' AND "updatedAt" < NOW() - (${leaseMs}::float8 * INTERVAL '1 millisecond'))
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
    // Another worker holds the lease — alive, or crashed without releasing it.
    // Say when the lease runs out, so the message can come back then.
    const retryAfterMs = Math.max(0, existingJob.updatedAt.getTime() + leaseMs - Date.now());
    throw new LeaseHeldError(`Job ${jobId} is leased by another worker.`, retryAfterMs);
  }

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Job disappeared after lock");

  console.log(`[Worker] Processing Job ${jobId} (Attempt ${job.attempts})`);

  // Start duration timer for job execution
  const endTimer = jobDurationHistogram.startTimer({
    provider: activeProvider,
    model: activeModel,
  });

  try {
    const aiResult = await withDeadline(executeAI(job.prompt), timeoutMs);

    if (
      !aiResult ||
      typeof aiResult.summary !== "string" ||
      !Array.isArray(aiResult.actionItems) ||
      !Array.isArray(aiResult.nextSteps)
    ) {
      throw new Error("Invalid AI response format");
    }
    
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

    // Record success counter metric
    jobsProcessedCounter.inc({ status: "success" });

  } catch (error) {
    console.error(`[Worker] Job ${jobId} execution failed:`, error);
    
    // Record failed counter metric
    jobsProcessedCounter.inc({ status: "failed" });

    const isRetryable = job.attempts < maxAttempts;
    const errorMessage = error instanceof Error ? error.message : "Unknown AI Processing Error";

    if (isRetryable) {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: "QUEUED", error: errorMessage, updatedAt: new Date() },
      });

      // A 429 means the quota is gone, not that the call glitched. Retrying in
      // a second would only burn another attempt, so back off the full amount.
      const rateLimited = (error as { status?: number } | null)?.status === 429;

      throw new RetryableError(
        "Temporary processing failure",
        rateLimited ? env.RETRY_MAX_DELAY_MS : undefined
      );
    } else {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: "FAILED", error: errorMessage, completedAt: new Date(), updatedAt: new Date() },
      });
      throw new FatalError("Maximum retries exhausted");
    }
  } finally {
    // Always observe the duration histogram
    endTimer();
  }
}

export class RetryableError extends Error {
  /**
   * How long to wait before this message comes back, when the failure itself
   * implies a delay — being rate limited, or waiting on another worker's
   * lease. Left unset for ordinary failures, which use the attempt ladder.
   */
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message);
  }
}
export class FatalError extends Error {}

/**
 * The job is owned by another worker's lease. This is contention, not a
 * failure, and must not spend the job's retry budget: when a worker crashes
 * mid-job its lease outlives the entire retry schedule, so counting these
 * redeliveries used to dead-letter the message while the job sat in
 * PROCESSING — permanently, with nothing left to finish it.
 */
export class LeaseHeldError extends RetryableError {
  /** Always known for a lease: it is the time left on it. `declare` narrows
   *  the optional field on RetryableError without redefining it. */
  declare readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message, retryAfterMs);
  }
}