import { prisma } from "../lib/prisma";
import {
  getConfirmChannel,
  invalidateRabbitMQConnection,
  EXCHANGES,
  ROUTING_KEYS,
} from "../lib/rabbitmq";
import { env } from "../lib/env";
import {
  outboxPublishedCounter,
  outboxPendingGauge,
  outboxBatchSizeHistogram,
  outboxPollDurationHistogram,
} from "../lib/metrics";

let isShuttingDown = false;

export async function startDispatcher() {
  console.log("[Dispatcher] Started. Polling for pending outbox events...");

  while (!isShuttingDown) {
    try {
      // Update queue depth metric
      const pendingCount = await prisma.outboxEvent.count({
        where: { status: "PENDING" },
      });

      outboxPendingGauge.set(pendingCount);

      await processOutboxBatch();
    } catch (error) {
      console.error("[Dispatcher] Error processing batch:", error);
    }

    await new Promise((resolve) =>
      setTimeout(resolve, env.OUTBOX_POLL_INTERVAL_MS)
    );
  }
}

async function processOutboxBatch() {
  const endPollTimer = outboxPollDurationHistogram.startTimer();

  let batch: any[] = [];

  try {
    batch = await prisma.$transaction(
      async (tx) => {
        const events: any[] = await tx.$queryRaw`
          SELECT id, "aggregateId", "eventType", payload
          FROM "OutboxEvent"
          WHERE status = 'PENDING'
          ORDER BY "createdAt" ASC
          LIMIT ${env.OUTBOX_BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        `;

        return events;
      },
      {
        maxWait: 5000,
        timeout: 10000,
      }
    );
  } finally {
    endPollTimer();
  }

  outboxBatchSizeHistogram.observe(batch.length);

  if (batch.length === 0) return;

  console.log(
    `[Dispatcher] Claimed ${batch.length} events for publishing.`
  );

  for (const event of batch) {
    const payload = JSON.stringify({
      eventId: event.id,
      eventType: event.eventType,
      jobId: event.payload.jobId,
    });

    try {
      const channel = await getConfirmChannel();

      await new Promise<void>((resolve, reject) => {
        channel.publish(
          EXCHANGES.TASKS,
          ROUTING_KEYS.TASK_CREATED,
          Buffer.from(payload),
          {
            persistent: true,
            messageId: event.id,
          },
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      await prisma.outboxEvent.update({
        where: {
          id: event.id,
        },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
      });

      outboxPublishedCounter.inc();

      console.log(
        `[Dispatcher] Event ${event.id} confirmed and marked PUBLISHED.`
      );
    } catch (error) {
      console.error(
        `[Dispatcher] Failed to publish event ${event.id}:`,
        error
      );

      // RabbitMQ connection/channel died.
      // Force a reconnect on the next publish attempt.
      if (
        error instanceof Error &&
        (error.message.includes("Channel closed") ||
          error.message.includes("IllegalOperation"))
      ) {
        invalidateRabbitMQConnection();
      }

      await prisma.outboxEvent.update({
        where: {
          id: event.id,
        },
        data: {
          publishAttempts: {
            increment: 1,
          },
          lastError:
            error instanceof Error
              ? error.message
              : "Publish failed",
        },
      });
    }
  }
}

export function shutdownDispatcher() {
  isShuttingDown = true;
}