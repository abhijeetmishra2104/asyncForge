import { prisma } from "../lib/prisma";
import { ConfirmChannel } from "amqplib";
import { env } from "../lib/env";
import { EXCHANGES, ROUTING_KEYS } from "../lib/rabbitmq";
import { 
  outboxPublishedCounter, 
  outboxPendingGauge, 
  outboxBatchSizeHistogram,
  outboxPollDurationHistogram 
} from "../lib/metrics";

let isShuttingDown = false;

export async function startDispatcher(channel: ConfirmChannel) {
  console.log("[Dispatcher] Started. Polling for pending outbox events...");

  while (!isShuttingDown) {
    try {
      // 1. Update Queue Depth Gauge
      // We do this before processing to get an accurate read of the backlog
      const pendingCount = await prisma.outboxEvent.count({
        where: { status: 'PENDING' }
      });
      outboxPendingGauge.set(pendingCount);

      // 2. Process the next batch
      await processOutboxBatch(channel);
    } catch (error) {
      console.error("[Dispatcher] Error processing batch:", error);
    }
    // Sleep to prevent busy looping
    await new Promise((resolve) => setTimeout(resolve, env.OUTBOX_POLL_INTERVAL_MS));
  }
}

async function processOutboxBatch(channel: ConfirmChannel) {
  // Start the timer to measure how long it takes to lock a batch in the DB
  const endPollTimer = outboxPollDurationHistogram.startTimer();
  
  let batch: any[] = [];
  try {
    // Safe concurrent batch claiming using FOR UPDATE SKIP LOCKED
    batch = await prisma.$transaction(async (tx) => {
      const events: any[] = await tx.$queryRaw`
        SELECT id, "aggregateId", "eventType", payload
        FROM "OutboxEvent"
        WHERE status = 'PENDING'
        ORDER BY "createdAt" ASC
        LIMIT ${env.OUTBOX_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `;
      return events;
    }, {
      maxWait: 5000, 
      timeout: 10000 
    });
  } finally {
    // Stop the timer as soon as the DB transaction completes
    endPollTimer();
  }

  // Record the actual number of events claimed in this cycle
  outboxBatchSizeHistogram.observe(batch.length);

  if (batch.length === 0) return;

  console.log(`[Dispatcher] Claimed ${batch.length} events for publishing.`);

  for (const event of batch) {
    const payload = JSON.stringify({
      eventId: event.id,
      eventType: event.eventType,
      jobId: event.payload.jobId,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        channel.publish(
          EXCHANGES.TASKS,
          ROUTING_KEYS.TASK_CREATED,
          Buffer.from(payload),
          { persistent: true, messageId: event.id },
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      // Publisher confirm received, safe to mark as published
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: "PUBLISHED", publishedAt: new Date() },
      });
      console.log(`[Dispatcher] Event ${event.id} confirmed and marked PUBLISHED.`);

      // Record published metric
      outboxPublishedCounter.inc();
    } catch (error) {
      console.error(`[Dispatcher] Failed to publish event ${event.id}:`, error);
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { 
          publishAttempts: { increment: 1 }, 
          lastError: error instanceof Error ? error.message : "Publish failed" 
        },
      });
    }
  }
}

export function shutdownDispatcher() {
  isShuttingDown = true;
}