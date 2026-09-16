import { Channel, ConsumeMessage } from "amqplib";
import { z } from "zod";
import {
  QUEUES,
  createRetryQueue,
  retryDelayMs,
} from "../lib/rabbitmq";

import { env } from "../lib/env";
import {
  processJob,
  RetryableError,
  FatalError,
  LeaseHeldError,
  type ProcessDeps,
} from "./processor";

const messageSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  jobId: z.string(),
});

/**
 * Redelivery counter. A dedicated header is used rather than x-death because
 * that one is reserved: RabbitMQ rewrites it whenever a message is dead-lettered
 * through the retry queues, so a value written by hand does not survive.
 */
const ATTEMPT_HEADER = "x-asyncforge-attempt";

function readAttempt(msg: ConsumeMessage): number {
  const headers = msg.properties.headers ?? {};

  const own = headers[ATTEMPT_HEADER];
  if (typeof own === "number" && own > 0) return own;

  // Messages already in flight when this shipped carry the old x-death form.
  const death = headers["x-death"];
  if (Array.isArray(death) && typeof death[0]?.count === "number") {
    return death[0].count + 1;
  }

  return 1;
}

/**
 * Parks the message in a TTL queue that feeds it back to the task queue after
 * `delayMs`, carrying `attempt` forward. If that cannot be done (channel or
 * broker trouble) the message is requeued rather than dropped.
 */
async function scheduleRetry(
  channel: Channel,
  msg: ConsumeMessage,
  delayMs: number,
  attempt: number
) {
  try {
    const retryQueue = await createRetryQueue(channel, delayMs);

    channel.publish("", retryQueue, msg.content, {
      persistent: true,
      headers: { [ATTEMPT_HEADER]: attempt },
    });

    channel.ack(msg);
  } catch (scheduleErr) {
    console.error("[Worker] Could not schedule retry; requeueing.", scheduleErr);

    channel.nack(msg, false, true);
  }
}

async function handleMessage(channel: Channel, msg: ConsumeMessage, deps: ProcessDeps) {
  const maxAttempts = deps.maxAttempts ?? env.MAX_JOB_ATTEMPTS;

  try {
    const payload = JSON.parse(msg.content.toString());

    const parsed = messageSchema.safeParse(payload);

    if (!parsed.success) {
      console.error(
        "[Worker] Invalid message envelope.",
        parsed.error
      );

      channel.nack(msg, false, false);
      return;
    }

    const { jobId } = parsed.data;

    await processJob(jobId, deps);

    channel.ack(msg);
  } catch (err) {
    // The job was already marked FAILED after exhausting its attempts.
    // Nothing more to do; send it to the DLQ for inspection.
    if (err instanceof FatalError) {
      console.error("[Worker] Fatal error; routing to DLQ.", err);

      channel.nack(msg, false, false);
      return;
    }

    const attempt = readAttempt(msg);

    // Another worker's lease covers this job. Check back once it could have
    // expired, keeping the same attempt number: waiting on a lease is not a
    // failed attempt. The lease bounds how long this can repeat — once it runs
    // out, this worker takes the job over.
    if (err instanceof LeaseHeldError) {
      await scheduleRetry(channel, msg, retryDelayMs(err.retryAfterMs), attempt);
      return;
    }

    // Everything else is retried, including errors this code does not
    // recognise. Previously an unrecognised error was assumed to be a
    // duplicate and ACKed, which silently destroyed the job — a database
    // blip during the acquisition query was enough to lose it. A genuine
    // duplicate never reaches here: processJob returns normally for an
    // already-terminal job.
    if (attempt > maxAttempts) {
      console.error(
        `[Worker] Giving up after ${attempt - 1} redeliveries; routing to DLQ.`,
        err
      );

      channel.nack(msg, false, false);
      return;
    }

    // Exponential backoff: base, 2×base, 4×base … with jitter, capped.
    const delay = retryDelayMs(env.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));

    console.log(
      `[Worker] Attempt ${attempt} failed (${
        err instanceof RetryableError ? "retryable" : "unexpected"
      }); retrying in ${delay} ms`,
      err instanceof RetryableError ? "" : err
    );

    await scheduleRetry(channel, msg, delay, attempt + 1);
  }
}

export async function startConsumer(channel: Channel, deps: ProcessDeps = {}) {
  await channel.prefetch(env.RABBITMQ_PREFETCH);

  console.log(`[Worker] Listening on queue: ${QUEUES.PROCESS}`);

  await channel.consume(
    QUEUES.PROCESS,
    (msg: ConsumeMessage | null) => {
      if (!msg) return;

      // amqplib does not await this callback. If the channel dies mid-message,
      // ack/nack throw — and an unhandled rejection takes the whole process
      // down. The broker redelivers anything left unacknowledged, so logging
      // is the right response.
      handleMessage(channel, msg, deps).catch((err) => {
        console.error("[Worker] Could not settle message; the broker will redeliver it.", err);
      });
    },
    {
      noAck: false,
    }
  );
}
