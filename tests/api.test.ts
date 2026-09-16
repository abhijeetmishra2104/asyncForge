import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import { QUEUES } from "../lib/rabbitmq";
import { closeConnections, readyCount, resetBroker, resetDatabase } from "./helpers/harness";
import { getStatus, registerDevice, submitTask } from "./helpers/http";

describe("HTTP API", () => {
  beforeEach(async () => {
    await resetDatabase();
    await resetBroker();
  });
  afterEach(closeConnections);
  afterAll(() => prisma.$disconnect());

  it("accepts a task with 202 and writes the Job and its OutboxEvent together", async () => {
    const token = await registerDevice();

    const { status, body } = await submitTask(token, "Design a rate limiter for a public API.");

    expect(status).toBe(202);
    expect(body).toMatchObject({ jobId: expect.any(String), status: "QUEUED" });

    const job = await prisma.job.findUniqueOrThrow({ where: { id: body.jobId } });
    const events = await prisma.outboxEvent.findMany({ where: { aggregateId: body.jobId } });
    expect(job.status).toBe("QUEUED");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: "PENDING", payload: { jobId: body.jobId } });
  });

  it("answers without touching RabbitMQ — publishing is the dispatcher's job", async () => {
    const token = await registerDevice();

    await submitTask(token, "Explain why the request path never waits on the queue.");

    // Nothing published: the task sits in the outbox until a dispatcher picks it up.
    expect(await readyCount(QUEUES.PROCESS)).toBe(0);
  });

  it("rejects a task without a device token", async () => {
    const { status } = await submitTask(undefined, "No credentials attached here.");
    expect(status).toBe(401);
    expect(await prisma.job.count()).toBe(0);
  });

  it("hides a job from any device that did not create it", async () => {
    const owner = await registerDevice();
    const stranger = await registerDevice();
    const { body } = await submitTask(owner, "Only the owner should see this.");

    expect((await getStatus(owner, body.jobId)).status).toBe(200);
    // Indistinguishable from a job that does not exist.
    expect((await getStatus(stranger, body.jobId)).status).toBe(404);
  });

  it("rate-limits a device that submits too many tasks", async () => {
    const token = await registerDevice();
    const statuses = [];
    // ANALYZE_RATE_LIMIT is 5 in the test environment.
    for (let i = 0; i < 6; i++) statuses.push((await submitTask(token, `Task number ${i} in a burst.`)).status);

    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
    expect(await prisma.job.count()).toBe(5);
  });
});
