import { createServer, Server } from "http";
import { prisma } from "./prisma";

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
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("# TODO: Prometheus metrics will be exposed here.\n");
    } 
    else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    console.log(`[${serviceName}] Health & Metrics server listening on port ${port}`);
  });

  return server;
}