import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import { QUEUES } from "../lib/rabbitmq";
import { processOutboxBatch } from "../dispatcher/publisher";
import {
  brokenConfirmChannel,
  closeConnections,
  confirmChannel,
  drainQueue,
  duplicatesIn,
  hangingConfirmChannel,
  publishedEventIds,
  resetBroker,
  resetDatabase,
  seedOutboxEvents,
  sleep,
  slowConfirmChannel,
  startDispatcherLoop,
  waitFor,
} from "./helpers/harness";

describe("Transactional outbox → dispatcher", () => {
  beforeEach(async () => {
    await resetDatabase();
    await resetBroker();
  });
  afterEach(closeConnections);
  afterAll(() => prisma.$disconnect());

  it("publishes every pending event to RabbitMQ and marks it PUBLISHED", async () => {
    const seeded = await seedOutboxEvents(10);
    const channel = await confirmChannel();

    await processOutboxBatch({ getChannel: async () => channel });

    expect(await publishedEventIds()).toHaveLength(10);
    const messages = await drainQueue(QUEUES.PROCESS);
    expect(messages.map((m) => m.eventId).sort()).toEqual(seeded.map((s) => s.eventId).sort());
  });

  it("never publishes the same event twice when two dispatchers overlap", async () => {
    // Dispatcher A claims a batch and publishes it slowly. While it is part-way
    // through, dispatcher B polls. B must not pick up A's batch: every event
    // it re-publishes becomes a duplicate task for the workers.
    await seedOutboxEvents(20);
    const slow = await slowConfirmChannel(25);
    const fast = await confirmChannel();

    const a = processOutboxBatch({ getChannel: async () => slow, batchSize: 20 });
    await sleep(80);
    const b = processOutboxBatch({ getChannel: async () => fast, batchSize: 20 });
    await Promise.all([a, b]);

    const messages = await drainQueue(QUEUES.PROCESS);
    expect(duplicatesIn(messages)).toEqual([]);
    expect(messages).toHaveLength(20);
  });

  it("3 dispatchers running side by side publish 100 events exactly once", async () => {
    const seeded = await seedOutboxEvents(100);
    const dispatchers = await Promise.all(
      [5, 10, 15].map(async (delay) => {
        const channel = await slowConfirmChannel(delay);
        return startDispatcherLoop({ getChannel: async () => channel, batchSize: 10 });
      })
    );

    await waitFor(async () => (await publishedEventIds()).length === 100, {
      timeoutMs: 30_000,
      describe: async () => `${(await publishedEventIds()).length}/100 published`,
    });
    await Promise.all(dispatchers.map((d) => d.stop()));

    const messages = await drainQueue(QUEUES.PROCESS);
    expect(duplicatesIn(messages)).toEqual([]);
    expect(new Set(messages.map((m) => m.eventId))).toEqual(new Set(seeded.map((s) => s.eventId)));
  });

  it("recovers a batch claimed by a dispatcher that died mid-publish", async () => {
    await seedOutboxEvents(10);

    // A claims the batch, then its broker never answers — a frozen or killed process.
    const hung = await hangingConfirmChannel();
    void processOutboxBatch({ getChannel: async () => hung, batchSize: 10 });
    await sleep(100);

    const healthy = await confirmChannel();
    const survivor = startDispatcherLoop({ getChannel: async () => healthy, batchSize: 10 });

    await waitFor(async () => (await publishedEventIds()).length === 10, {
      timeoutMs: 15_000,
      describe: async () => `${(await publishedEventIds()).length}/10 published`,
    });
    await survivor.stop();

    const messages = await drainQueue(QUEUES.PROCESS);
    expect(duplicatesIn(messages)).toEqual([]);
    expect(messages).toHaveLength(10);
  });

  it("keeps events PENDING while the broker is down, then publishes them once it is back", async () => {
    await seedOutboxEvents(5);

    const broken = await brokenConfirmChannel();
    await processOutboxBatch({ getChannel: async () => broken });

    const stuck = await prisma.outboxEvent.findMany();
    expect(stuck.every((e) => e.status === "PENDING")).toBe(true);
    expect(stuck.every((e) => e.publishAttempts === 1 && e.lastError)).toBe(true);

    // The very next poll with a working broker delivers them — no waiting out a timeout.
    const healthy = await confirmChannel();
    await processOutboxBatch({ getChannel: async () => healthy });

    expect(await publishedEventIds()).toHaveLength(5);
    expect(await drainQueue(QUEUES.PROCESS)).toHaveLength(5);
  });
});
