import { connectRabbitMQ, setupTopology } from "../lib/rabbitmq";
import { startDispatcher, shutdownDispatcher } from "./publisher";
import { prisma } from "../lib/prisma";

let connection: any = null;
let channel: any = null;

async function bootstrap() {
  connection = await connectRabbitMQ();
  channel = await connection.createConfirmChannel();
  await setupTopology(channel);
  
  startDispatcher(channel);
}

async function gracefulShutdown() {
  console.log("[Dispatcher] Graceful shutdown initiated...");
  shutdownDispatcher();
  
  if (channel) await channel.close();
  if (connection) await connection.close();
  await prisma.$disconnect();
  console.log("[Dispatcher] Shutdown complete.");
  process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

bootstrap().catch((err) => {
  console.error("[Dispatcher] Fatal error during bootstrap:", err);
  process.exit(1);
});