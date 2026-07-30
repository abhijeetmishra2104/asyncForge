import { env } from "../lib/env";
import { startHealthServer } from "../lib/health";
import { connectRabbitMQ, setupTopology } from "../lib/rabbitmq";
import { startConsumer } from "./consumer";
import { prisma } from "../lib/prisma";

let connection: any = null;
let channel: any = null;
let healthServer: any = null;

async function bootstrap() {
  connection = await connectRabbitMQ();
  channel = await connection.createChannel();
  await setupTopology(channel);
  
  // Start the health server
  healthServer = startHealthServer(
    env.WORKER_HEALTH_PORT, 
    "Worker", 
    () => channel !== null && connection !== null // RabbitMQ check
  );

  await startConsumer(channel);
}

async function gracefulShutdown() {
  console.log("[Worker] Graceful shutdown initiated...");
  if (healthServer) healthServer.close(); // Close health HTTP server
  if (channel) await channel.close();
  if (connection) await connection.close();
  await prisma.$disconnect();
  console.log("[Worker] Shutdown complete.");
  process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

bootstrap().catch((err) => {
  console.error("[Worker] Fatal error during bootstrap:", err);
  process.exit(1);
});