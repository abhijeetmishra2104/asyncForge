import { createServer, Server } from "http";
import { prisma } from "./prisma";
import { registry } from "./metrics";

export function startHealthServer(
  port: number,
  serviceName: string,
  checkRabbitMQ: () => boolean
): Server {
  const server = createServer(async (req, res) => {
    // LIVENESS & READINESS PROBE
    if (req.url === "/healthz" && req.method === "GET") {
      try {
        // 1. Check PostgreSQL Connection
        await prisma.$queryRawUnsafe('SELECT 1');
        
        // 2. Check RabbitMQ Connection
        const isRabbitHealthy = checkRabbitMQ();
        
        if (!isRabbitHealthy) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "error", message: "RabbitMQ disconnected" }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", service: serviceName }));
      } catch (error) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", message: "Database disconnected" }));
      }
    } 
    // METRICS PROBE (For future Prometheus scraping)
    else if (req.url === "/metrics" && req.method === "GET") {
      try {
        res.writeHead(200, { "Content-Type": registry.contentType });
        const metrics = await registry.metrics();
        res.end(metrics);
      } catch (err) {
        res.writeHead(500);
        res.end("Failed to generate metrics");
      }
    } 
    else {
      res.writeHead(404);
      res.end();
    }
  });

    console.log(`[${serviceName}] Starting health server on ${port}...`);

    server.on("listening", () => {
    console.log(`[${serviceName}] Health server listening`);
    });

    server.on("error", (err) => {
    console.error(`[${serviceName}] Health server failed`, err);
    });

    server.listen(port);

  return server;
}