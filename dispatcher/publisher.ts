import { hostname } from "node:os";
import { prisma } from "../lib/prisma";
import type { ConfirmChannel } from "amqplib";
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

/**
 * What a dispatcher reaches outside itself for. Production passes nothing and
 * uses the shared confirm channel; tests pass their own channel so several
 * dispatchers can run side by side in one process.
 */
export type DispatcherDeps = {
  getChannel?: () => Promise<ConfirmChannel>;
  batchSize?: number;
  /** Recorded on claimed rows. Defaults to the pod name, so a stuck claim names its owner. */
  dispatcherId?: string;
  claimTimeoutMs?: number;
};

const DEFAULT_DISPATCHER_ID = `${hostname()}:${process.pid}`;

type ClaimedEvent = {
  id: string;
  eventType: string;
  payload: { jobId: string };
  createdAt: Date;
};

export async function processOutboxBatch(deps: DispatcherDeps = {}) {
  const getChannel = deps.getChannel ?? getConfirmChannel;
  const batchSize = deps.batchSize ?? env.OUTBOX_BATCH_SIZE;
  const dispatcherId = deps.dispatcherId ?? DEFAULT_DISPATCHER_ID;
  const claimTimeoutMs = deps.claimTimeoutMs ?? env.OUTBOX_CLAIM_TIMEOUT_MS;

  const endPollTimer = outboxPollDurationHistogram.startTimer();

  let batch: ClaimedEvent[] = [];

  try {
    // Claim, don't just lock. This used to SELECT ... FOR UPDATE SKIP LOCKED in
    // a transaction that committed the moment the rows came back, so the locks
    // were gone before a single event was published. A second dispatcher
    // polling during that window found the same rows still PENDING and
    // published every one of them again.
    //
    // Now the claim is written in the same statement that finds the rows. It
    // outlives the statement, so other dispatchers skip these events until they
    // are PUBLISHED — or until the claim expires, which is how a batch held by
    // a dispatcher that crashed gets picked up again.
    batch = await prisma.$queryRaw<ClaimedEvent[]>`
      UPDATE "OutboxEvent"
      SET "claimedAt" = NOW(), "claimedBy" = ${dispatcherId}
      WHERE id IN (
        SELECT id
        FROM "OutboxEvent"
        WHERE status = 'PENDING'
          AND (
            "claimedAt" IS NULL
            OR "claimedAt" < NOW() - (${claimTimeoutMs}::float8 * INTERVAL '1 millisecond')
          )
        ORDER BY "createdAt" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, "eventType", payload, "createdAt"
    `;
  } finally {
    endPollTimer();
  }

  // UPDATE ... RETURNING does not preserve the subquery's order.
  batch.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

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
      const channel = await getChannel();

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
          // Give the event back rather than holding it until the claim expires,
          // so the next poll retries as soon as the broker is reachable again.
          claimedAt: null,
          claimedBy: null,
        },
      });
    }
  }
}

export function shutdownDispatcher() {
  isShuttingDown = true;
}