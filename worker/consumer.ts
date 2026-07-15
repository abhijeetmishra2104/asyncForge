import { Channel, ConsumeMessage } from "amqplib";
import { z } from "zod";
import { QUEUES, createRetryQueue, EXCHANGES } from "../lib/rabbitmq";
import { env } from "../lib/env";
import { processJob, RetryableError, FatalError } from "./processor";

const messageSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  jobId: z.string(),
});

export async function startConsumer(channel: Channel) {
  await channel.prefetch(env.RABBITMQ_PREFETCH);

  console.log(`[Worker] Listening on queue: ${QUEUES.PROCESS}`);

  channel.consume(QUEUES.PROCESS, async (msg: ConsumeMessage | null) => {
    if (!msg) return;

    try {
      const payload = JSON.parse(msg.content.toString());
      const parsed = messageSchema.safeParse(payload);

      if (!parsed.success) {
        console.error("[Worker] Invalid message envelope. Dead-lettering.", parsed.error);
        return channel.nack(msg, false, false); 
      }

      const { jobId } = parsed.data;
      
      await processJob(jobId, 1);
      channel.ack(msg);

    } catch (error) {
      if (error instanceof RetryableError) {
        // Calculate exponential backoff
        const deathHeader = msg.properties.headers?.["x-death"];
        const attempt = deathHeader ? deathHeader[0].count + 1 : 1;
        
        const delay = Math.min(
          env.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 1000,
          env.RETRY_MAX_DELAY_MS
        );
        
        console.log(`[Worker] Scheduling retry for job in ${Math.round(delay)}ms`);
        const retryQueue = await createRetryQueue(channel, Math.round(delay));
        
        // Publish to delay queue, ACK original
        channel.publish("", retryQueue, msg.content, {
          persistent: true,
          headers: { "x-death": [{ count: attempt }] }
        });
        channel.ack(msg);
      } else if (error instanceof FatalError) {
        console.error("[Worker] Fatal error, routing to DLQ.");
        channel.nack(msg, false, false); // Sends to DLX configured on QUEUES.PROCESS
      } else {
        // Handling Lock Bypass (e.g. duplicate COMPLETED)
        console.log("[Worker] Duplicate message safely bypassed. ACKing.");
        channel.ack(msg);
      }
    }
  }, { noAck: false });
}