import amqp, { Channel, ConfirmChannel } from "amqplib";
import { env } from "./env";

type RabbitMQConnection = Awaited<ReturnType<typeof amqp.connect>>;

let connection: RabbitMQConnection | null = null;
let confirmChannel: ConfirmChannel | null = null;
let connecting: Promise<void> | null = null;

export const EXCHANGES = {
  TASKS: "asyncforge.tasks",
  DLX: "asyncforge.dlx",
};

export const QUEUES = {
  PROCESS: "asyncforge.tasks.process",
  DLQ: "asyncforge.tasks.dlq",
  RETRY: "asyncforge.tasks.retry",
};

export const ROUTING_KEYS = {
  TASK_CREATED: "ai.task.created",
};
async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates (or recreates) a RabbitMQ connection + confirm channel.
 * Automatically retries forever until RabbitMQ becomes available.
 */
async function createConnection(): Promise<void> {
  if (connecting) {
    await connecting;
    return;
  }

  connecting = (async () => {
    while (true) {
      try {
        console.log("[RabbitMQ] Connecting...");

        connection = await amqp.connect(env.RABBITMQ_URL);

        connection.on("error", (err) => {
          console.error("[RabbitMQ] Connection error:", err);
        });

        connection.on("close", () => {
          console.warn("[RabbitMQ] Connection closed.");

          connection = null;
          confirmChannel = null;
        });

        confirmChannel = await connection.createConfirmChannel();

        await setupTopology(confirmChannel);

        console.log("[RabbitMQ] Connected.");

        break;
      } catch (err) {
        console.error(
          "[RabbitMQ] Failed to connect. Retrying in 5 seconds..."
        );

        connection = null;
        confirmChannel = null;

        await sleep(5000);
      }
    }

    connecting = null;
  })();

  await connecting;
}

/**
 * Returns a valid confirm channel.
 * Automatically reconnects if the previous connection died.
 */
export async function getConfirmChannel(): Promise<ConfirmChannel> {
  if (!connection || !confirmChannel) {
    await createConnection();
  }

  return confirmChannel!;
}

/**
 * Worker uses a normal channel.
 */
export async function getChannel(): Promise<Channel> {
  if (!connection) {
    await createConnection();
  }

  return connection!.createChannel();
}

/**
 * Called whenever a publish fails because the channel died.
 */
export function invalidateRabbitMQConnection() {
  confirmChannel = null;

  if (connection) {
    try {
      connection.removeAllListeners();
      connection.close().catch(() => {});
    } catch {}

    connection = null;
  }
}

/**
 * Graceful shutdown.
 */
export async function closeRabbitMQ() {
  try {
    if (confirmChannel) {
      await confirmChannel.close();
    }
  } catch {}

  try {
    if (connection) {
      await connection.close();
    }
  } catch {}

  confirmChannel = null;
  connection = null;
}

export function isRabbitMQConnected(): boolean {
  return connection !== null && confirmChannel !== null;
}

/**
 * RabbitMQ topology
 */
export async function setupTopology(
  channel: Channel | ConfirmChannel
) {
  await channel.assertExchange(EXCHANGES.TASKS, "direct", {
    durable: true,
  });

  await channel.assertExchange(EXCHANGES.DLX, "direct", {
    durable: true,
  });

  await channel.assertQueue(QUEUES.DLQ, {
    durable: true,
  });

  await channel.bindQueue(
    QUEUES.DLQ,
    EXCHANGES.DLX,
    ROUTING_KEYS.TASK_CREATED
  );

  await channel.assertQueue(QUEUES.PROCESS, {
    durable: true,
    deadLetterExchange: EXCHANGES.DLX,
    deadLetterRoutingKey: ROUTING_KEYS.TASK_CREATED,
    arguments: {
      "x-queue-type": env.RABBITMQ_QUEUE_TYPE,
    },
  });

  await channel.bindQueue(
    QUEUES.PROCESS,
    EXCHANGES.TASKS,
    ROUTING_KEYS.TASK_CREATED
  );
}

/** Jitter variants per delay tier. Each distinct delay is its own queue. */
const JITTER_VARIANTS = 3;

/**
 * Picks the delay for a retry that should wait roughly `targetMs`.
 *
 * Delayed retries live in TTL queues, one queue per distinct delay. The delay
 * used to be exponential backoff plus Math.random() * 1000 milliseconds, so
 * nearly every retry minted a queue nobody ever deleted — and CloudAMQP's free
 * tier caps a vhost at 100 queues, after which no retry can be scheduled at all.
 *
 * Delays now come from a fixed ladder — base, 2×base, 4×base … capped at the
 * maximum — and jitter picks one of three variants of the tier (+0%, +10%,
 * +20%). That still spreads out retries that fail together, and the number of
 * retry queues can never exceed tiers × 3 however long the system runs.
 */
export function retryDelayMs(targetMs: number, random: () => number = Math.random): number {
  const base = env.RETRY_BASE_DELAY_MS;
  const max = env.RETRY_MAX_DELAY_MS;

  let tier = base;
  while (tier < targetMs && tier < max) tier *= 2;
  tier = Math.min(tier, max);

  const variant = Math.floor(random() * JITTER_VARIANTS);
  return Math.min(Math.round(tier * (1 + variant / 10)), max);
}

/**
 * Retry queue
 */
export async function createRetryQueue(
  channel: Channel,
  delayMs: number
) {
  const queueName = `${QUEUES.RETRY}.${delayMs}`;

  await channel.assertQueue(queueName, {
    durable: true,
    deadLetterExchange: EXCHANGES.TASKS,
    deadLetterRoutingKey: ROUTING_KEYS.TASK_CREATED,
    messageTtl: delayMs,
  });

  return queueName;
}