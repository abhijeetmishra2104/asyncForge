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
      "x-queue-type": "quorum",
    },
  });

  await channel.bindQueue(
    QUEUES.PROCESS,
    EXCHANGES.TASKS,
    ROUTING_KEYS.TASK_CREATED
  );
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