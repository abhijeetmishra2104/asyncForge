import { connectRabbitMQ, setupTopology } from "../lib/rabbitmq";
import { startConsumer } from "./consumer";
import { prisma } from "../lib/prisma";

let connection: any = null;
let channel: any = null;

async function bootstrap() {
  connection = await connectRabbitMQ();
  channel = await connection.createChannel();
  await setupTopology(channel);
  
  await startConsumer(channel);
}

async function gracefulShutdown() {
  console.log("[Worker] Graceful shutdown initiated...");
  if (channel) {
    console.log("[Worker] Closing channel to stop receiving new messages...");
    await channel.close();
  }
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