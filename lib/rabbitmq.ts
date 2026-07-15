import amqp, { Channel, ConfirmChannel } from "amqplib";
import { env } from "./env";

type RabbitMQConnection = Awaited<ReturnType<typeof amqp.connect>>;

export const EXCHANGES = {
  TASKS: "asyncforge.tasks",
  DLX: "asyncforge.dlx",
};

export const QUEUES = {
  PROCESS: "asyncforge.tasks.process",
  DLQ: "asyncforge.tasks.dlq",
  RETRY: "asyncforge.tasks.retry", // Dynamically suffixed based on delay
};

export const ROUTING_KEYS = {
  TASK_CREATED: "ai.task.created",
};

export async function connectRabbitMQ(): Promise<RabbitMQConnection> {
  let retries = 5;
  while (retries > 0) {
    try {
      const connection = await amqp.connect(env.RABBITMQ_URL);
      connection.on("error", (err) =>
        console.error("[RabbitMQ] Connection error", err),
      );
      connection.on("close", () =>
        console.error("[RabbitMQ] Connection closed"),
      );
      return connection;
    } catch (error) {
      retries -= 1;
      console.error(`[RabbitMQ] Connection failed. Retries left: ${retries}`);
      if (retries === 0) throw error;
      await new Promise((res) => setTimeout(res, 5000));
    }
  }
  throw new Error("Failed to connect to RabbitMQ");
}

export async function setupTopology(channel: Channel | ConfirmChannel) {
  // Main Exchange
  await channel.assertExchange(EXCHANGES.TASKS, "direct", { durable: true });
  // Dead Letter Exchange
  await channel.assertExchange(EXCHANGES.DLX, "direct", { durable: true });

  // DLQ
  await channel.assertQueue(QUEUES.DLQ, { durable: true });
  await channel.bindQueue(QUEUES.DLQ, EXCHANGES.DLX, ROUTING_KEYS.TASK_CREATED);

  // Main Task Queue (Routing dead letters to DLX)
  await channel.assertQueue(QUEUES.PROCESS, {
    durable: true,
    deadLetterExchange: EXCHANGES.DLX,
    deadLetterRoutingKey: ROUTING_KEYS.TASK_CREATED,
    arguments: { "x-queue-type": "quorum" },
  });
  await channel.bindQueue(
    QUEUES.PROCESS,
    EXCHANGES.TASKS,
    ROUTING_KEYS.TASK_CREATED,
  );
}

export async function createRetryQueue(channel: Channel, delayMs: number) {
  const queueName = `${QUEUES.RETRY}.${delayMs}`;
  await channel.assertQueue(queueName, {
    durable: true,
    deadLetterExchange: EXCHANGES.TASKS, // Route back to main exchange on TTL expiry
    deadLetterRoutingKey: ROUTING_KEYS.TASK_CREATED,
    messageTtl: delayMs,
  });
  return queueName;
}
