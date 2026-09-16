import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import {
  closeConnections,
  confirmChannel,
  fakeAI,
  resetBroker,
  resetDatabase,
  startDispatcherLoop,
  startWorker,
  waitFor,
  waitForAllJobs,
} from "./helpers/harness";
import { getStatus, registerDevice, submitTask } from "./helpers/http";

describe("End to end", () => {
  beforeEach(async () => {
    await resetDatabase();
    await resetBroker();
  });
  afterEach(closeConnections);
  afterAll(() => prisma.$disconnect());

  it("takes a task from HTTP through the outbox, dispatcher, RabbitMQ and a worker, back to the status API", async () => {
    const channel = await confirmChannel();
    const dispatcher = startDispatcherLoop({ getChannel: async () => channel });
    const ai = fakeAI({ latencyMs: 100 });
    await startWorker({ executeAI: ai });

    const token = await registerDevice();
    const submitted = await submitTask(token, "Outline a zero-downtime database migration.");
    expect(submitted.status).toBe(202);
    const { jobId } = submitted.body;

    const result = await waitFor(async () => {
      const { body } = await getStatus(token, jobId);
      return body.status === "COMPLETED" ? body : null;
    });
    await dispatcher.stop();

    expect(result.output.summary).toBe("Result for: Outline a zero-downtime database migration.");
    expect(result.attempts).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { status: "PUBLISHED" } })).toBe(1);
    expect(ai.calls).toHaveLength(1);
  });

  it("loses no task when a worker is killed in the middle of a burst", async () => {
    const leaseMs = 3_000;
    const channel = await confirmChannel();
    const dispatcher = startDispatcherLoop({ getChannel: async () => channel });

    // The victim finishes two tasks, then hangs inside Gemini on its third.
    const victimAI = fakeAI({ latencyMs: 100, hangAfter: 2 });
    const victim = await startWorker({ executeAI: victimAI, leaseMs });
    await startWorker({ executeAI: fakeAI({ latencyMs: 100 }), leaseMs });
    await startWorker({ executeAI: fakeAI({ latencyMs: 100 }), leaseMs });

    const token = await registerDevice();
    const jobIds: string[] = [];
    // Five per device is the rate limit, so spread the burst across devices.
    for (let d = 0; d < 4; d++) {
      const deviceToken = d === 0 ? token : await registerDevice();
      for (let i = 0; i < 5; i++) {
        jobIds.push((await submitTask(deviceToken, `burst task ${d}-${i}`)).body.jobId);
      }
    }

    await waitFor(async () => victimAI.calls.length === 3);
    await victim.crash();

    await waitForAllJobs(jobIds, "COMPLETED", 30_000);
    await dispatcher.stop();

    expect(await prisma.job.count({ where: { id: { in: jobIds }, status: "COMPLETED" } })).toBe(20);
  });
});
