import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import {
  closeConnections,
  createQueuedJob,
  fakeAI,
  publishTask,
  resetBroker,
  resetDatabase,
  sleep,
  startWorker,
  waitForAllJobs,
} from "./helpers/harness";

/** Each fake Gemini call takes this long, so throughput is bounded by the model, as it is in production. */
const MODEL_LATENCY_MS = 250;

async function drainBacklog(workerCount: number, jobCount: number) {
  await resetDatabase();
  await resetBroker();

  const models = Array.from({ length: workerCount }, () => fakeAI({ latencyMs: MODEL_LATENCY_MS }));
  const workers = await Promise.all(models.map((executeAI) => startWorker({ executeAI })));

  const jobIds: string[] = [];
  for (let i = 0; i < jobCount; i++) jobIds.push((await createQueuedJob(`backlog task ${i}`)).jobId);

  const started = performance.now();
  for (const id of jobIds) await publishTask(id);
  await waitForAllJobs(jobIds, "COMPLETED", 60_000);
  const seconds = (performance.now() - started) / 1000;

  await Promise.all(workers.map((w) => w.stop()));
  return { seconds, jobsPerWorker: models.map((m) => m.calls.length) };
}

describe("Horizontal scaling (competing consumers)", () => {
  afterEach(closeConnections);
  afterAll(() => prisma.$disconnect());

  it("4 workers drain a 24-job backlog at least 2.5x faster than 1 worker", async () => {
    const one = await drainBacklog(1, 24);
    const four = await drainBacklog(4, 24);
    const speedup = one.seconds / four.seconds;

    console.table([
      { workers: 1, seconds: one.seconds.toFixed(2), "jobs/sec": (24 / one.seconds).toFixed(1) },
      { workers: 4, seconds: four.seconds.toFixed(2), "jobs/sec": (24 / four.seconds).toFixed(1) },
    ]);
    console.log(`speedup: ${speedup.toFixed(2)}x`);

    expect(speedup).toBeGreaterThanOrEqual(2.5);
  });

  it("spreads the backlog across every worker instead of piling onto one", async () => {
    const { jobsPerWorker } = await drainBacklog(4, 24);
    console.log(`jobs handled per worker: ${jobsPerWorker.join(" / ")}`);

    // prefetch=1: a worker only receives its next task once it has acked the last.
    expect(jobsPerWorker.every((n) => n >= 3)).toBe(true);
    expect(jobsPerWorker.reduce((a, b) => a + b, 0)).toBe(24);
  });

  it("a worker added mid-backlog starts taking jobs straight away", async () => {
    await resetDatabase();
    await resetBroker();

    const original = fakeAI({ latencyMs: MODEL_LATENCY_MS });
    await startWorker({ executeAI: original });

    const jobIds: string[] = [];
    for (let i = 0; i < 20; i++) jobIds.push((await createQueuedJob(`surge task ${i}`)).jobId);
    const started = performance.now();
    for (const id of jobIds) await publishTask(id);

    // Scale out while the backlog is draining — `kubectl scale --replicas=4`.
    await sleep(1_000);
    const added = [fakeAI({ latencyMs: MODEL_LATENCY_MS }), fakeAI({ latencyMs: MODEL_LATENCY_MS }), fakeAI({ latencyMs: MODEL_LATENCY_MS })];
    await Promise.all(added.map((executeAI) => startWorker({ executeAI })));

    await waitForAllJobs(jobIds, "COMPLETED", 60_000);
    const seconds = (performance.now() - started) / 1000;
    const byNewWorkers = added.reduce((n, m) => n + m.calls.length, 0);
    console.log(`original worker: ${original.calls.length} jobs, added workers: ${byNewWorkers} jobs, ${seconds.toFixed(2)}s total`);

    // The claim is that the new workers start pulling immediately, and this is
    // what proves it: they took most of the remaining backlog.
    expect(byNewWorkers).toBeGreaterThanOrEqual(8);

    // Wall-clock guard, deliberately loose. One worker alone could not beat
    // 20 × 250ms = 5s however fast the machine is, so finishing inside that
    // means the extra workers did real work — without making the test fail on
    // a loaded laptop, which a tighter bound does.
    expect(seconds).toBeLessThan(20 * (MODEL_LATENCY_MS / 1000));
  });
});
