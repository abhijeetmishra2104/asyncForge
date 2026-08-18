import { Channel, ConsumeMessage } from "amqplib";
import { z } from "zod";
import {
  QUEUES,
  createRetryQueue,
} from "../lib/rabbitmq";

import { env } from "../lib/env";
import {
  processJob,
  RetryableError,
  FatalError,
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

export async function startConsumer(channel: Channel) {
  await channel.prefetch(env.RABBITMQ_PREFETCH);

  console.log(`[Worker] Listening on queue: ${QUEUES.PROCESS}`);

  await channel.consume(
    QUEUES.PROCESS,
    async (msg: ConsumeMessage | null) => {
      if (!msg) return;

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

        await processJob(jobId, 1);

        channel.ack(msg);
      } catch (err) {
        // The job was already marked FAILED after exhausting its attempts.
        // Nothing more to do; send it to the DLQ for inspection.
        if (err instanceof FatalError) {
          console.error("[Worker] Fatal error; routing to DLQ.", err);

          channel.nack(msg, false, false);
          return;
        }

        // Everything else is retried, including errors this code does not
        // recognise. Previously an unrecognised error was assumed to be a
        // duplicate and ACKed, which silently destroyed the job — a database
        // blip during the acquisition query was enough to lose it. A genuine
        // duplicate never reaches here: processJob returns normally for an
        // already-terminal job.
        const attempt = readAttempt(msg);

        if (attempt > env.MAX_JOB_ATTEMPTS) {
          console.error(
            `[Worker] Giving up after ${attempt - 1} redeliveries; routing to DLQ.`,
            err
          );

          channel.nack(msg, false, false);
          return;
        }

        const delay = Math.min(
          env.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1) +
            Math.random() * 1000,
          env.RETRY_MAX_DELAY_MS
        );

        console.log(
          `[Worker] Attempt ${attempt} failed (${
            err instanceof RetryableError ? "retryable" : "unexpected"
          }); retrying in ${Math.round(delay)} ms`,
          err instanceof RetryableError ? "" : err
        );

        try {
          const retryQueue = await createRetryQueue(
            channel,
            Math.round(delay)
          );

          channel.publish("", retryQueue, msg.content, {
            persistent: true,
            headers: { [ATTEMPT_HEADER]: attempt + 1 },
          });

          channel.ack(msg);
        } catch (scheduleErr) {
          // The retry could not even be scheduled (channel or broker trouble).
          // Requeue so another delivery picks it up rather than dropping it.
          console.error("[Worker] Could not schedule retry; requeueing.", scheduleErr);

          channel.nack(msg, false, true);
        }
      }
    },
    {
      noAck: false,
    }
  );
}