import amqp, { type ConfirmChannel } from "amqplib";
import { inject } from "vitest";
import { prisma } from "../../lib/prisma";
import type { AIResponse } from "../../lib/gemini";
import { EXCHANGES, QUEUES, ROUTING_KEYS, setupTopology } from "../../lib/rabbitmq";
import { startConsumer } from "../../worker/consumer";
import type { ProcessDeps } from "../../worker/processor";
import { processOutboxBatch, type DispatcherDeps } from "../../dispatcher/publisher";

type Connection = Awaited<ReturnType<typeof amqp.connect>>;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `check` returns something truthy, or fails with `describe()` explaining the last state. */
export async function waitFor<T>(
  check: () => Promise<T | false | null | undefined>,
  { timeoutMs = 20_000, intervalMs = 50, describe = async () => "condition not met" }: {
    timeoutMs?: number;
    intervalMs?: number;
    describe?: () => Promise<string>;
  } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms: ${await describe()}`);
}

/* -------------------------------------------------------------------------- */
/* Database                                                                   */
/* -------------------------------------------------------------------------- */

export async function resetDatabase() {
  // setup-env.ts already refuses non-local hosts; check again right before the
  // one statement that would be destructive against a real database.
  const host = new URL(process.env.DATABASE_URL!).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`Refusing to TRUNCATE on non-local host "${host}".`);
  }
  await prisma.$executeRawUnsafe(
    `TRUNCATE "OutboxEvent", "Job", "Device", "RateLimit" CASCADE`
  );
}

/** Writes a Job and its OutboxEvent in one transaction — exactly what POST /api/analyze does. */
export async function createQueuedJob(prompt = "Summarise the outbox pattern.") {
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.create({ data: { prompt, status: "QUEUED" } });
    const event = await tx.outboxEvent.create({
      data: { aggregateId: job.id, eventType: "AI_TASK_CREATED", payload: { jobId: job.id } },
    });
    return { jobId: job.id, eventId: event.id };
  });
}

export async function getJob(jobId: string) {
  return prisma.job.findUniqueOrThrow({ where: { id: jobId } });
}

export async function waitForJobStatus(
  jobId: string,
  status: "COMPLETED" | "FAILED",
  timeoutMs = 20_000
) {
  return waitFor(
    async () => {
      const job = await getJob(jobId);
      return job.status === status ? job : null;
    },
    {
      timeoutMs,
      describe: async () => {
        const job = await getJob(jobId);
        const dlq = await readyCount(QUEUES.DLQ);
        return `job ${jobId} is ${job.status} (attempts=${job.attempts}), wanted ${status}; ${dlq} message(s) in the dead-letter queue`;
      },
    }
  );
}

export async function waitForAllJobs(jobIds: string[], status: "COMPLETED" | "FAILED", timeoutMs = 30_000) {
  return waitFor(
    async () => {
      const done = await prisma.job.count({ where: { id: { in: jobIds }, status } });
      return done === jobIds.length;
    },
    {
      timeoutMs,
      describe: async () => {
        const rows = await prisma.job.groupBy({
          by: ["status"],
          where: { id: { in: jobIds } },
          _count: true,
        });
        return `wanted all ${jobIds.length} ${status}, got ${JSON.stringify(
          rows.map((r) => `${r.status}:${r._count}`)
        )}`;
      },
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Broker                                                                     */
/* -------------------------------------------------------------------------- */

const openConnections: Connection[] = [];

export async function openConnection(): Promise<Connection> {
  const connection = await amqp.connect(inject("rabbitUrl"));
  // Closing a connection mid-flight is the point of several tests; don't let
  // the resulting error events crash the run.
  connection.on("error", () => {});
  openConnections.push(connection);
  return connection;
}

export async function closeConnections() {
  const all = openConnections.splice(0);
  await Promise.all(all.map((c) => c.close().catch(() => {})));
}

async function management(path: string, init: RequestInit = {}) {
  const res = await fetch(`${inject("rabbitManagementUrl")}/api${path}`, {
    ...init,
    headers: { Authorization: `Basic ${Buffer.from("guest:guest").toString("base64")}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`RabbitMQ management ${init.method ?? "GET"} ${path} → ${res.status}`);
  }
  return res;
}

export async function listQueueNames(): Promise<string[]> {
  const res = await management("/queues/%2F?columns=name");
  return ((await res.json()) as { name: string }[]).map((q) => q.name);
}

export async function retryQueueNames() {
  return (await listQueueNames()).filter((name) => name.startsWith(`${QUEUES.RETRY}.`));
}

/** Deletes every queue, including leftover retry queues, and re-declares the real topology. */
export async function resetBroker() {
  for (const name of await listQueueNames()) {
    await management(`/queues/%2F/${encodeURIComponent(name)}`, { method: "DELETE" });
  }
  const connection = await openConnection();
  const channel = await connection.createChannel();
  await setupTopology(channel);
  await channel.close();
}

/** Ready messages in a queue, read straight from the broker (the management API's counts lag by seconds). */
export async function readyCount(queue: string) {
  const connection = await openConnection();
  const channel = await connection.createChannel();
  try {
    return (await channel.checkQueue(queue)).messageCount;
  } finally {
    await channel.close().catch(() => {});
  }
}

/** Takes every ready message off a queue and returns the parsed bodies. */
export async function drainQueue(queue: string): Promise<{ eventId: string; jobId: string }[]> {
  const connection = await openConnection();
  const channel = await connection.createChannel();
  const bodies: { eventId: string; jobId: string }[] = [];
  for (;;) {
    const msg = await channel.get(queue, { noAck: false });
    if (!msg) break;
    bodies.push(JSON.parse(msg.content.toString()));
    channel.ack(msg);
  }
  await channel.close();
  return bodies;
}

/** Publishes a task message the way the dispatcher does, bypassing the outbox. */
export async function publishTask(jobId: string, eventId = `evt_${jobId}`) {
  const connection = await openConnection();
  const channel = await connection.createConfirmChannel();
  channel.publish(
    EXCHANGES.TASKS,
    ROUTING_KEYS.TASK_CREATED,
    Buffer.from(JSON.stringify({ eventId, eventType: "AI_TASK_CREATED", jobId })),
    { persistent: true, messageId: eventId }
  );
  await channel.waitForConfirms();
  await channel.close();
}

/* -------------------------------------------------------------------------- */
/* Fake model                                                                 */
/* -------------------------------------------------------------------------- */

export type FakeAI = ((prompt: string) => Promise<AIResponse>) & { calls: string[] };

/**
 * Stands in for Gemini. Every behaviour a test needs from the real API —
 * latency, transient 503s, permanent failure, a call that never returns — is a
 * switch here, so none of it depends on the network or burns quota.
 */
export function fakeAI(
  opts: {
    latencyMs?: number;
    /** Fail this many calls in total, then succeed. */
    failFirst?: number;
    /** Fail the first call for each distinct prompt, then succeed for it. */
    failOncePerPrompt?: boolean;
    alwaysFail?: boolean;
    /** Calls after this many never resolve — the process is "stuck" in Gemini. */
    hangAfter?: number;
  } = {}
): FakeAI {
  const calls: string[] = [];
  const failedPrompts = new Set<string>();
  let failures = 0;

  const fn = async (prompt: string): Promise<AIResponse> => {
    calls.push(prompt);
    if (opts.hangAfter !== undefined && calls.length > opts.hangAfter) {
      return new Promise<never>(() => {});
    }
    if (opts.latencyMs) await sleep(opts.latencyMs);

    const shouldFail =
      opts.alwaysFail ||
      (opts.failFirst !== undefined && failures < opts.failFirst) ||
      (opts.failOncePerPrompt && !failedPrompts.has(prompt));

    if (shouldFail) {
      failures += 1;
      failedPrompts.add(prompt);
      throw Object.assign(new Error("503 Service Unavailable (fake)"), { status: 503 });
    }
    return {
      summary: `Result for: ${prompt}`,
      actionItems: [{ title: "Do the thing", description: "Fake output", priority: "HIGH" }],
      nextSteps: ["Ship it"],
    };
  };

  return Object.assign(fn, { calls });
}

/* -------------------------------------------------------------------------- */
/* Workers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Starts a real worker: its own AMQP connection, the production consumer, the
 * production processJob. Only the model and timings are injected.
 */
export async function startWorker(deps: ProcessDeps = {}) {
  const connection = await openConnection();
  const channel = await connection.createChannel();
  channel.on("error", () => {});
  await startConsumer(channel, deps);

  return {
    /**
     * Dies the way a killed pod dies: the connection drops with the in-flight
     * message unacknowledged, and RabbitMQ hands it to someone else.
     */
    crash: () => connection.close().catch(() => {}),
    stop: () => connection.close().catch(() => {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Dispatchers                                                                */
/* -------------------------------------------------------------------------- */

export async function confirmChannel(): Promise<ConfirmChannel> {
  const connection = await openConnection();
  return connection.createConfirmChannel();
}

/** A confirm channel whose broker acknowledgements arrive `delayMs` late — a slow network. */
export async function slowConfirmChannel(delayMs: number): Promise<ConfirmChannel> {
  const real = await confirmChannel();
  const slow = Object.create(real) as ConfirmChannel;
  slow.publish = (exchange, routingKey, content, options, callback) =>
    real.publish(exchange, routingKey, content, options, (err, ok) => {
      setTimeout(() => callback?.(err, ok), delayMs);
    });
  return slow;
}

/** Accepts a publish and never confirms it: the dispatcher process has frozen or died mid-batch. */
export async function hangingConfirmChannel(): Promise<ConfirmChannel> {
  const real = await confirmChannel();
  const hung = Object.create(real) as ConfirmChannel;
  hung.publish = () => true;
  return hung;
}

/** Rejects every publish: the broker is unreachable. */
export async function brokenConfirmChannel(): Promise<ConfirmChannel> {
  const real = await confirmChannel();
  const broken = Object.create(real) as ConfirmChannel;
  broken.publish = (_e, _r, _c, _o, callback) => {
    setImmediate(() => callback?.(new Error("broker unreachable (fake)"), undefined as never));
    return true;
  };
  return broken;
}

/** Runs the production batch function in a loop, as the dispatcher process does. */
export function startDispatcherLoop(deps: DispatcherDeps) {
  let running = true;
  const loop = (async () => {
    while (running) {
      await processOutboxBatch(deps).catch(() => {});
      await sleep(Number(process.env.OUTBOX_POLL_INTERVAL_MS));
    }
  })();
  return {
    stop: async () => {
      running = false;
      await loop;
    },
  };
}

export async function seedOutboxEvents(count: number) {
  const created = [];
  for (let i = 0; i < count; i++) created.push(await createQueuedJob(`task ${i}`));
  return created;
}

export async function publishedEventIds() {
  const rows = await prisma.outboxEvent.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Each eventId that reached the queue more than once, with its count. */
export function duplicatesIn(messages: { eventId: string }[]) {
  const counts = new Map<string, number>();
  for (const m of messages) counts.set(m.eventId, (counts.get(m.eventId) ?? 0) + 1);
  return [...counts].filter(([, n]) => n > 1).map(([eventId, n]) => ({ eventId, copies: n }));
}
