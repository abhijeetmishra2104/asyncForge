import { connectRabbitMQ, setupTopology } from "../lib/rabbitmq";
import { startDispatcher, shutdownDispatcher } from "./publisher";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";
import { startHealthServer } from "../lib/health";
import { Server } from "http";

let connection: any = null;
let channel: any = null;
let healthServer: Server | null = null;

async function bootstrap() {
  connection = await connectRabbitMQ();
  channel = await connection.createConfirmChannel();
  await setupTopology(channel);
  
  // Start the health server
  healthServer = startHealthServer(
    env.DISPATCHER_HEALTH_PORT, 
    "Dispatcher", 
    () => channel !== null && connection !== null
  );

  // Start the core polling loop
  startDispatcher(channel);
}

async function gracefulShutdown() {
  console.log("[Dispatcher] Graceful shutdown initiated...");
  
  // 1. Stop the polling loop
  shutdownDispatcher();
  
  // 2. Close the HTTP health server
  if (healthServer) {
    healthServer.close();
    console.log("[Dispatcher] Health server closed.");
  }
  
  // 3. Close RabbitMQ and DB connections
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