import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import { QUEUES } from "../lib/rabbitmq";
import { abortInFlightJobs } from "../worker/processor";
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

  it("times out a model call that never returns rather than holding the job forever", async () => {
    // Production caps this at GEMINI_TIMEOUT_MS. Before it existed, a hung
    // request held its worker slot and its lease until the pod was replaced —
    // the slowest job on record ran 340 seconds.
    const ai = fakeAI({ hangAfter: 0 });
    await startWorker({ executeAI: ai, timeoutMs: 300 });
    const { jobId } = await createQueuedJob();

    const startedAt = Date.now();
    await publishTask(jobId);
    const job = await waitForJobStatus(jobId, "FAILED", 15_000);

    expect(job.attempts).toBe(3);
    expect(job.error).toContain("exceeded");
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  });

  it("hands a job back when the worker shuts down, without waiting out the lease", async () => {
    // A Spot reclaim or a rollout stops a worker mid-job. If it simply
    // disappears, nothing may touch that job until its lease expires. A
    // shutting-down worker instead fails its work as retryable, which puts the
    // job straight back to QUEUED.
    const leaseMs = 30_000;
    const { jobId } = await createQueuedJob();

    const leaving = await startWorker({ executeAI: fakeAI({ hangAfter: 0 }), leaseMs });
    await publishTask(jobId);
    await waitFor(async () => (await getJob(jobId)).status === "PROCESSING");

    const startedAt = Date.now();
    abortInFlightJobs();
    await leaving.stop();

    const survivorAI = fakeAI();
    await startWorker({ executeAI: survivorAI, leaseMs });

    const job = await waitForJobStatus(jobId, "COMPLETED", 20_000);
    expect(survivorAI.calls).toHaveLength(1);
    // Far inside the 30s lease: the job was released, not waited out.
    expect(Date.now() - startedAt).toBeLessThan(10_000);
    expect(job.attempts).toBe(2);
  });

  it("runs several jobs at once on one worker when prefetch allows it", async () => {
    // Jobs are almost entirely spent waiting on Gemini, so a single worker can
    // hold several. At prefetch 1 these eight jobs would take 8 x 300ms.
    const ai = fakeAI({ latencyMs: 300 });
    await startWorker({ executeAI: ai, prefetch: 4 });

    const jobs = [];
    for (let i = 0; i < 8; i++) jobs.push(await createQueuedJob(`concurrent task ${i}`));
    const startedAt = Date.now();
    for (const { jobId } of jobs) await publishTask(jobId);
    await waitForAllJobs(jobs.map((j) => j.jobId), "COMPLETED", 30_000);

    const seconds = (Date.now() - startedAt) / 1000;
    console.log(`8 jobs on 1 worker at prefetch 4: ${seconds.toFixed(2)}s`);
    expect(seconds).toBeLessThan(1.6);
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
