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
        if (err instanceof RetryableError) {
          const deathHeader = msg.properties.headers?.["x-death"];

          const attempt = deathHeader
            ? deathHeader[0].count + 1
            : 1;

          const delay = Math.min(
            env.RETRY_BASE_DELAY_MS *
              Math.pow(2, attempt - 1) +
              Math.random() * 1000,
            env.RETRY_MAX_DELAY_MS
          );

          console.log(
            `[Worker] Retrying in ${Math.round(delay)} ms`
          );

          const retryQueue = await createRetryQueue(
            channel,
            Math.round(delay)
          );

          channel.publish("", retryQueue, msg.content, {
            persistent: true,
            headers: {
              "x-death": [{ count: attempt }],
            },
          });

          channel.ack(msg);
          return;
        }

        if (err instanceof FatalError) {
          console.error("[Worker] Fatal error.");

          channel.nack(msg, false, false);
          return;
        }

        console.log(
          "[Worker] Duplicate/already processed job."
        );

        channel.ack(msg);
      }
    },
    {
      noAck: false,
    }
  );
}