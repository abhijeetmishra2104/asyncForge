import { env } from "../lib/env";
import { startHealthServer } from "../lib/health";
import { startConsumer } from "./consumer";
import { prisma } from "../lib/prisma";
import {
  getChannel,
  closeRabbitMQ,
  isRabbitMQConnected,
} from "../lib/rabbitmq";

import { Server } from "http";

let healthServer: Server | null = null;

async function bootstrap() {
  const channel = await getChannel();

  healthServer = startHealthServer(
    env.WORKER_HEALTH_PORT,
    "Worker",
    isRabbitMQConnected
  );

  await startConsumer(channel);
}

async function gracefulShutdown() {
  console.log("[Worker] Graceful shutdown initiated...");

  if (healthServer !== null) {
  await new Promise<void>((resolve) => {
    healthServer!.close(() => resolve());
  });
}

  await closeRabbitMQ();
  await prisma.$disconnect();

  console.log("[Worker] Shutdown complete.");

  process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

bootstrap().catch(async (err) => {
  console.error("[Worker] Fatal error during bootstrap:", err);

  await closeRabbitMQ();
  await prisma.$disconnect();

  process.exit(1);
});