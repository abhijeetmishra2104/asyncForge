import { startDispatcher, shutdownDispatcher } from "./publisher";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";
import { startHealthServer } from "../lib/health";
import { closeRabbitMQ, getConfirmChannel } from "../lib/rabbitmq";
import { Server } from "http";

let healthServer: Server | null = null;

async function bootstrap() {
  // Force RabbitMQ connection on startup.
  // This also declares exchanges/queues.
  await getConfirmChannel();

  // Start health server
  healthServer = startHealthServer(
    env.DISPATCHER_HEALTH_PORT,
    "Dispatcher",
    () => true // RabbitMQ manager handles reconnects internally
  );

  // Start polling loop
  await startDispatcher();
}

async function gracefulShutdown() {
  console.log("[Dispatcher] Graceful shutdown initiated...");

  shutdownDispatcher();

  if (healthServer) {
    await new Promise<void>((resolve) =>
      healthServer!.close(() => resolve())
    );
    console.log("[Dispatcher] Health server closed.");
  }

  await closeRabbitMQ();
  await prisma.$disconnect();

  console.log("[Dispatcher] Shutdown complete.");
  process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

bootstrap().catch(async (err) => {
  console.error("[Dispatcher] Fatal error during bootstrap:", err);

  await closeRabbitMQ();
  await prisma.$disconnect();

  process.exit(1);
});