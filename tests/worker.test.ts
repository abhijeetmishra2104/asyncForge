import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import { QUEUES } from "../lib/rabbitmq";
import {
  closeConnections,
  createQueuedJob,
  fakeAI,
  getJob,
  publishTask,
  readyCount,
  resetBroker,
  resetDatabase,
  retryQueueNames,
  startWorker,
  waitFor,
  waitForAllJobs,
  waitForJobStatus,
} from "./helpers/harness";

describe("Workers", () => {
  beforeEach(async () => {
    await resetDatabase();
    await resetBroker();
  });
  afterEach(closeConnections);
  afterAll(() => prisma.$disconnect());

  it("completes a job, saves the output, and acknowledges the message", async () => {
    const ai = fakeAI();
    await startWorker({ executeAI: ai });
    const { jobId } = await createQueuedJob("Plan a launch.");

    await publishTask(jobId);
    const job = await waitForJobStatus(jobId, "COMPLETED");

    expect(job.output).toMatchObject({ summary: "Result for: Plan a launch." });
    expect(job.attempts).toBe(1);
    expect(job.completedAt).not.toBeNull();
    expect(ai.calls).toHaveLength(1);
    // Acked, so nothing is left to be redelivered.
    expect(await readyCount(QUEUES.PROCESS)).toBe(0);
  });

  it("calls Gemini once even when two workers receive duplicate copies of a task", async () => {
    // At-least-once delivery means the same task can arrive twice. The job row
    // is the lock: only one worker may move it to PROCESSING.
    const ai = fakeAI({ latencyMs: 300 });
    await startWorker({ executeAI: ai });
    await startWorker({ executeAI: ai });
    const { jobId } = await createQueuedJob();

    await publishTask(jobId, "evt_duplicate");
    await publishTask(jobId, "evt_duplicate");

    await waitForJobStatus(jobId, "COMPLETED");
    await waitFor(async () => (await readyCount(QUEUES.PROCESS)) === 0);

    expect(ai.calls).toHaveLength(1);
    expect((await getJob(jobId)).attempts).toBe(1);
  });

  it("retries a transient Gemini failure with backoff and completes on a later attempt", async () => {
    const ai = fakeAI({ failFirst: 2 });
    await startWorker({ executeAI: ai });
    const { jobId } = await createQueuedJob();

    await publishTask(jobId);
    const job = await waitForJobStatus(jobId, "COMPLETED");

    expect(ai.calls).toHaveLength(3);
    expect(job.attempts).toBe(3);
    expect(await readyCount(QUEUES.DLQ)).toBe(0);
  });

  it("marks a job FAILED and dead-letters it once retries are exhausted", async () => {
    const ai = fakeAI({ alwaysFail: true });
    await startWorker({ executeAI: ai });
    const { jobId } = await createQueuedJob();

    await publishTask(jobId);
    const job = await waitForJobStatus(jobId, "FAILED");

    expect(job.attempts).toBe(3);
    expect(job.error).toContain("503");
    expect(ai.calls).toHaveLength(3);
    await waitFor(async () => (await readyCount(QUEUES.DLQ)) === 1);
  });

  it("finishes a job on another worker when its worker crashes mid-flight", async () => {
    // The lease is how long a PROCESSING job belongs to its worker. Production
    // uses 5 minutes; 6 seconds here keeps the test short while staying well
    // above the whole retry backoff, which is what exposes the failure mode.
    const leaseMs = 6_000;
    const { jobId } = await createQueuedJob();

    const doomed = await startWorker({ executeAI: fakeAI({ hangAfter: 0 }), leaseMs });
    await publishTask(jobId);
    await waitFor(async () => (await getJob(jobId)).status === "PROCESSING");

    await doomed.crash();

    const survivorAI = fakeAI();
    await startWorker({ executeAI: survivorAI, leaseMs });

    const job = await waitForJobStatus(jobId, "COMPLETED", 25_000);
    expect(survivorAI.calls).toHaveLength(1);
    expect(job.attempts).toBe(2);
    expect(await readyCount(QUEUES.DLQ)).toBe(0);
  });

  it("keeps the number of retry queues bounded however many retries happen", async () => {
    // Retries wait in TTL queues. If each retry gets its own queue, a busy day
    // accumulates hundreds of them — and CloudAMQP's free tier caps a vhost at
    // 100 queues, after which no retry can be scheduled at all.
    const ai = fakeAI({ failOncePerPrompt: true });
    for (let i = 0; i < 4; i++) await startWorker({ executeAI: ai });

    const jobs = [];
    for (let i = 0; i < 30; i++) jobs.push(await createQueuedJob(`flaky task ${i}`));
    for (const { jobId } of jobs) await publishTask(jobId);

    await waitForAllJobs(jobs.map((j) => j.jobId), "COMPLETED");

    // RETRY_BASE_DELAY_MS=100 and RETRY_MAX_DELAY_MS=800 give delay tiers of
    // 100, 200, 400 and 800ms, each with three jitter variants: at most 12.
    const queues = await retryQueueNames();
    expect(queues.length, `retry queues: ${queues.join(", ")}`).toBeLessThanOrEqual(12);
  });
});
