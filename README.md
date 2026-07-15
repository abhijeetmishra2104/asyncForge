# AsyncForge — Fault-Tolerant Distributed AI Task Processing System

AsyncForge is a robust, production-ready distributed system demonstrating the decoupling of long-running AI workloads from the synchronous HTTP request lifecycle. 

## The Synchronous Failure Pattern
Typically, AI applications issue an HTTP request that directly calls a Large Language Model (LLM). This couples the user's connection to the AI processing time (often 10–30+ seconds). If a timeout occurs at the proxy, server, or client level, the connection breaks, the user sees an error, and the server loses state of the execution.

## Architectural Solution
AsyncForge accepts the task, durably records it to a PostgreSQL database, and immediately returns `HTTP 202 Accepted`. A background dispatcher safely publishes the task to a message broker (RabbitMQ) using the **Transactional Outbox Pattern**, ensuring no database/broker dual-write inconsistency. Independent, competing consumers (Workers) claim tasks idempotently, execute them via Groq, write the results back to the database, and finally acknowledge the message. 

### Why RabbitMQ?
RabbitMQ was selected over PostgreSQL polling and Kafka because it is explicitly designed for high-throughput work queues and competing consumers. It natively provides durable queues, publisher confirms, consumer ACKs/NACKs, dead-letter routing, and message redelivery without complex stream consumer-group management. Using Postgres as a primary queue introduces heavy write amplification and row-lock contention. Kafka is brilliant for immutable event streams but overly complex for basic isolated work dispatching.

### Transactional Outbox & Dual-Write Consistency
If we write to the database and immediately publish to RabbitMQ, a crash between these two operations results in data inconsistency (dual-write problem). 
AsyncForge solves this by inserting the `Job` and an `OutboxEvent` in *one single database transaction*. A background Dispatcher reliably polls this outbox (`FOR UPDATE SKIP LOCKED`), publishes the message, waits for a **Publisher Confirm**, and *only then* marks the outbox event as `PUBLISHED`.

### Idempotency and At-Least-Once Delivery
RabbitMQ guarantees *at-least-once* delivery. Messages may be redelivered due to network partitions, outbox duplicate publishing, or worker crashes prior to an ACK. The Worker leverages atomic SQL updates to ensure a job transitions from `QUEUED` to `PROCESSING` exactly once per lifecycle phase, discarding duplicate executions and safely ACKing messages for already-completed jobs. Exactly-once is theoretically impossible in distributed messaging; we achieve effectively-once through idempotent persistence boundaries.

### Bounded Retries & Dead-Letter Queues (DLQ)
If an AI process fails (e.g., rate limits, bad JSON from LLM), the system does not crash or infinitely hot-loop. It pushes the message to a dynamically created delay queue (`asyncforge.tasks.retry.*`) with exponential backoff and jitter. After the TTL expires, it routes back to the main queue. If max attempts are reached, it routes to `asyncforge.tasks.dlq` (DLQ) to prevent poison messages from consuming worker resources indefinitely.

### Liveness vs. Readiness
* **Liveness (`/api/health`)**: Indicates the Node.js process is running. Used to restart dead containers.
* **Readiness (`/api/ready`)**: Verifies connection to required dependencies (PostgreSQL). Used by load balancers to route traffic.

## Local Setup
Ensure Docker is installed.

1. Clone repository and run:
   ```bash
   pnpm install