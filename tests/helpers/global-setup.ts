import { execSync } from "node:child_process";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { RabbitMQContainer } from "@testcontainers/rabbitmq";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    rabbitUrl: string;
    rabbitManagementUrl: string;
  }
}

/**
 * Starts the two pieces of infrastructure the system actually depends on, as
 * real servers, and applies the real migrations. Nothing here is mocked: the
 * point of these tests is to exercise row locks, redelivery and dead-lettering,
 * which only exist in the real thing.
 */
export default async function setup(project: TestProject) {
  const [postgres, rabbit] = await Promise.all([
    new PostgreSqlContainer("postgres:16-alpine").start(),
    // The management image exposes the HTTP API the tests use to inspect queues.
    new RabbitMQContainer("rabbitmq:3.13-management-alpine").start(),
  ]);

  const databaseUrl = postgres.getConnectionUri();

  execSync("pnpm exec prisma migrate deploy", {
    // Explicit DATABASE_URL wins over anything prisma.config.ts loads from .env.
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });

  project.provide("databaseUrl", databaseUrl);
  project.provide("rabbitUrl", rabbit.getAmqpUrl());
  project.provide(
    "rabbitManagementUrl",
    `http://${rabbit.getHost()}:${rabbit.getMappedPort(15672)}`
  );

  return async () => {
    await Promise.all([postgres.stop(), rabbit.stop()]);
  };
}
