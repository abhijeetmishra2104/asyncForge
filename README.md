# ⚡ AsyncForge

> **A fault-tolerant, horizontally scalable asynchronous AI task
> processing system built with Next.js, PostgreSQL, RabbitMQ, and
> Groq.**

# ⚡ AsyncForge

> **A fault-tolerant, horizontally scalable asynchronous AI task processing system built with Next.js, PostgreSQL, RabbitMQ, and Groq.**

### ⚡ Accept Fast · 📦 Queue Reliably · ⚙️ Process Asynchronously · 🛡️ Recover From Failure

---

## 🚀 What is AsyncForge?

A simple AI application often works like this:

``` text
User → HTTP Request → AI Processing → Wait... → Response
```

That is fine for a demo. It becomes fragile when AI tasks are slow.

-   HTTP requests can time out.
-   Users can close the browser.
-   Workers can crash.
-   Groq can rate-limit or temporarily fail.
-   Messages can be delivered more than once.
-   A database write can succeed while queue publishing fails.

**AsyncForge separates the HTTP request lifecycle from the AI processing
lifecycle.**

``` text
Accepted → Queued → Processing → Completed
```

The API accepts a task, durably stores it, immediately returns
`202 Accepted` with a `jobId`, and lets independent background workers
process the AI task later.

------------------------------------------------------------------------

## 🏗️ Architecture

``` mermaid
flowchart LR
    U["👤 User"] -->|Submit task| API["🌐 Next.js API"]
    API -->|Job + OutboxEvent<br/>one transaction| DB[("🐘 PostgreSQL")]
    API -->|202 + jobId| U

    DB -->|PENDING events| D["📤 Dispatcher"]
    D -->|Publish| MQ["🐇 RabbitMQ"]

    MQ --> W1["⚙️ Worker A"]
    MQ --> W2["⚙️ Worker B"]
    MQ --> W3["⚙️ Worker C"]

    W1 --> AI["🤖 Groq"]
    W2 --> AI
    W3 --> AI

    AI --> W1
    AI --> W2
    AI --> W3

    W1 -->|Save result| DB
    W2 -->|Save result| DB
    W3 -->|Save result| DB

    U -.->|Poll status through API| API
```

### End-to-end flow

1.  User submits an AI task.
2.  The Next.js API validates the prompt.
3.  PostgreSQL creates a `Job` and `OutboxEvent` in the **same
    transaction**.
4.  The API immediately returns `202 Accepted` and a `jobId`.
5.  The dispatcher polls pending outbox events in bounded batches.
6.  The dispatcher publishes events to RabbitMQ.
7.  RabbitMQ distributes tasks among competing workers.
8.  A worker atomically acquires a job and marks it `PROCESSING`.
9.  The worker calls Groq.
10. The structured AI output is validated.
11. The result is persisted as `COMPLETED`.
12. The worker ACKs the RabbitMQ message only after durable completion.
13. The frontend polls the status API and displays the result.

------------------------------------------------------------------------

## 🔥 Why the Transactional Outbox Pattern?

The naive approach is:

``` text
1. INSERT Job into PostgreSQL
2. Publish task to RabbitMQ
```

But this can happen:

``` text
Database INSERT succeeds ✅
        ↓
Application crashes 💥
        ↓
RabbitMQ publish never happens ❌
        ↓
Job remains QUEUED forever
```

PostgreSQL and RabbitMQ are separate systems. A normal PostgreSQL
transaction cannot atomically commit a RabbitMQ publish.

AsyncForge instead performs:

``` text
BEGIN
  INSERT Job
  INSERT OutboxEvent
COMMIT
```

Either **both records exist or neither exists**.

An `OutboxEvent` is a durable record saying:

> **This event still needs to be published to the message broker.**

``` mermaid
flowchart TD
    A["POST /api/analyze"] --> B["BEGIN Transaction"]
    B --> C["Create Job: QUEUED"]
    C --> D["Create OutboxEvent: PENDING"]
    D --> E["COMMIT"]
    E --> F["Return 202 Accepted"]
    D -.-> G["Dispatcher"]
    G --> H["RabbitMQ"]
```

The dispatcher later publishes the event and waits for a RabbitMQ
**publisher confirm** before marking the event `PUBLISHED`.

AsyncForge provides **at-least-once delivery**, not exactly-once
delivery. Workers therefore use durable PostgreSQL job state as an
idempotency boundary.

------------------------------------------------------------------------

## ✨ Key Features

  -----------------------------------------------------------------------
  Feature                             Why it matters
  ----------------------------------- -----------------------------------
  ⚡ `202 Accepted` API               Slow AI work does not block HTTP
                                      requests

  📦 Transactional Outbox             Prevents lost dispatch intent

  🐇 RabbitMQ                         Queues and distributes independent
                                      tasks

  ⚙️ Competing Consumers              Multiple workers process tasks
                                      concurrently

  🎯 `prefetch = 1`                   One unacknowledged task per worker

  🛡️ Idempotent Job State             Duplicate messages do not blindly
                                      rerun terminal jobs

  📤 Publisher Confirms               Events become published only after
                                      broker confirmation

  🔁 Bounded Retries                  Temporary failures can be retried

  ☠️ Dead-Letter Queue                Poison/exhausted messages are
                                      isolated

  🧠 Zod Validation                   Validates requests, messages, and
                                      AI output

  🐳 Docker Compose                   Reproducible multi-service
                                      environment

  🚀 Horizontal Scaling               Add worker replicas to increase
                                      throughput
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 🧱 Tech Stack

-   **Frontend/API:** Next.js, React, TypeScript, Tailwind CSS
-   **Database:** PostgreSQL, Prisma ORM
-   **Broker:** RabbitMQ, `amqplib`
-   **AI:** Groq
-   **Validation:** Zod
-   **Infrastructure:** Docker, Docker Compose
-   **CI:** GitHub Actions
-   **Package Manager:** pnpm

------------------------------------------------------------------------

## 📦 Service Responsibilities

``` text
Web/API      → Accept requests and expose job state
PostgreSQL   → Source of truth for Jobs and OutboxEvents
Dispatcher   → Reliably move outbox events to RabbitMQ
RabbitMQ     → Queue and distribute tasks
Workers      → Execute AI workloads and persist results
Groq         → Perform AI analysis
```

------------------------------------------------------------------------

# 🛠️ Local Setup

## Prerequisites

Install:

-   Node.js
-   pnpm
-   Docker and Docker Compose
-   Access to a PostgreSQL database
-   A Groq API key

> The supplied Docker Compose file uses an external PostgreSQL database
> through `DATABASE_URL`. RabbitMQ runs in Docker.

### 1. Clone the repository

``` bash
git clone <YOUR_REPOSITORY_URL>
cd asyncforge
```

### 2. Install dependencies

``` bash
pnpm install
```

### 3. Create `.env`

``` env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require"
GROQ_API_KEY="your_groq_api_key"

RABBITMQ_URL="amqp://asyncforge:password@localhost:5672"

OUTBOX_POLL_INTERVAL_MS=1000
OUTBOX_BATCH_SIZE=20
RABBITMQ_PREFETCH=1
```

> Never commit `.env` or production credentials.

### 4. Generate Prisma Client

``` bash
pnpm prisma generate
```

### 5. Apply migrations

``` bash
pnpm db:deploy
```

### 6. Start RabbitMQ

``` bash
docker compose up -d rabbitmq
```

Check it:

``` bash
docker compose ps
```

RabbitMQ Management UI:

``` text
http://localhost:15672
```

Local credentials:

``` text
Username: asyncforge
Password: password
```

### 7. Start the web application

``` bash
pnpm dev
```

Open:

``` text
http://localhost:3000
```

### 8. Start the dispatcher

In a new terminal:

``` bash
pnpm dispatcher
```

### 9. Start one worker

In another terminal:

``` bash
pnpm worker
```

Your system is now running:

``` text
Next.js → PostgreSQL → Dispatcher → RabbitMQ → Worker → Groq
```

------------------------------------------------------------------------

# 🐳 Run Everything with Docker

Create `.env`:

``` env
DATABASE_URL="your_postgresql_connection_string"
GROQ_API_KEY="your_groq_api_key"
```

Build and start:

``` bash
docker compose up --build -d
```

Check services:

``` bash
docker compose ps
```

Follow all logs:

``` bash
docker compose logs -f
```

Dispatcher logs:

``` bash
docker compose logs -f dispatcher
```

Worker logs:

``` bash
docker compose logs -f worker
```

Stop:

``` bash
docker compose down
```

Stop and remove RabbitMQ data:

``` bash
docker compose down -v
```

------------------------------------------------------------------------

# 🧪 Stress Test 1 --- Baseline Bottleneck

### Goal

Prove that one worker processes jobs sequentially while the web API
continues accepting requests.

### Step 1 --- Run exactly one worker

``` bash
docker compose up -d --scale worker=1
```

Verify:

``` bash
docker compose ps
```

### Step 2 --- Watch worker logs

``` bash
docker compose logs -f worker
```

### Step 3 --- Submit five tasks rapidly

Open multiple frontend tabs and submit five different prompts as quickly
as possible.

Example prompts:

``` text
Design a scalable notification service.
Explain database sharding strategies.
Design a URL shortening service.
Create a backend plan for a chat application.
Explain a fault-tolerant payment workflow.
```

### Expected flow

``` text
Task 1 → Worker → PROCESSING
Task 2 → QUEUED
Task 3 → QUEUED
Task 4 → QUEUED
Task 5 → QUEUED

Task 1 → Persist → ACK
Task 2 → Process
Task 3 → Process
...
```

Because `prefetch = 1`, one worker handles one unacknowledged task at a
time.

### What this proves

> **Decoupling:** The web server does not wait for Groq and remains
> responsive while the worker drains the backlog.

> **Durability:** Accepted jobs remain represented by durable state
> instead of disappearing because processing capacity is busy.

------------------------------------------------------------------------

# 🧪 Stress Test 2 --- Horizontal Scaling

### Goal

Prove that the processing layer scales through RabbitMQ competing
consumers.

### Step 1 --- Scale to three workers

``` bash
docker compose up -d --scale worker=3
```

Verify:

``` bash
docker compose ps
```

### Step 2 --- Follow worker logs

``` bash
docker compose logs -f worker
```

### Step 3 --- Submit five tasks rapidly

Submit five different AI tasks from the frontend.

### Expected flow

``` text
                    RabbitMQ
                       │
             ┌─────────┼─────────┐
             │         │         │
             ▼         ▼         ▼
          Worker 1  Worker 2  Worker 3
             │         │         │
           Task 1    Task 2    Task 3
```

RabbitMQ distributes available tasks among competing consumers.

Scale further:

``` bash
docker compose up -d --scale worker=5
```

Scale back:

``` bash
docker compose up -d --scale worker=1
```

### What this proves

> **Elasticity:** More processing capacity can be added by starting
> worker replicas.

> **Competing Consumers:** RabbitMQ distributes work without a custom
> worker load balancer.

------------------------------------------------------------------------

# 🧪 Stress Test 3 --- Dispatcher Resilience and Outbox Recovery

### Goal

Simulate complete background infrastructure failure and prove that
accepted tasks are not lost.

### Step 1 --- Stop dispatcher and workers

``` bash
docker compose stop dispatcher worker
```

Check:

``` bash
docker compose ps
```

The web service remains available.

### Step 2 --- Submit three new tasks

Submit three tasks through the frontend.

The API should still return:

``` text
HTTP 202 Accepted
```

The durable state is conceptually:

``` text
Job         → QUEUED
OutboxEvent → PENDING
```

The dispatcher is offline, so the new events have not been published to
RabbitMQ.

### Step 3 --- Restart the dispatcher

``` bash
docker compose start dispatcher
```

Watch it:

``` bash
docker compose logs -f dispatcher
```

The dispatcher should discover pending outbox events and publish them.

### Step 4 --- Restart the worker

``` bash
docker compose start worker
```

Watch processing:

``` bash
docker compose logs -f worker
```

### Expected recovery

``` text
Dispatcher + Workers DOWN
            ↓
User submits tasks
            ↓
Job + OutboxEvent committed
            ↓
202 Accepted
            ↓
Dispatcher restarts
            ↓
Pending events discovered
            ↓
RabbitMQ receives tasks
            ↓
Worker restarts
            ↓
Tasks complete
```

### What this proves

> **Fault Tolerance:** Background service failure does not make accepted
> jobs disappear.

> **Transactional Outbox:** The intention to publish survives in
> PostgreSQL.

> **Eventual Processing:** Services can restart and continue from
> durable state.

------------------------------------------------------------------------

# 🎤 The Interview Mic Drop

### Decoupling

> The HTTP request lifecycle is completely separated from AI processing
> time. The API returns `202 Accepted`, while workers continue
> independently.

### Elasticity

> Adding processing capacity is as simple as adding worker replicas.
> RabbitMQ distributes tasks among competing consumers.

### Fault Tolerance

> PostgreSQL is the source of truth, the transactional outbox preserves
> dispatch intent, RabbitMQ provides at-least-once delivery, and
> idempotent job-state handling tolerates duplicate messages and process
> crashes.

------------------------------------------------------------------------

## ⚠️ Delivery Semantics

AsyncForge does **not** claim exactly-once delivery.

A duplicate may occur when:

``` text
RabbitMQ confirms publish
        ↓
Dispatcher crashes
        ↓
OutboxEvent was not marked PUBLISHED
        ↓
The event may be published again
```

A worker may also persist `COMPLETED` and crash before ACKing the
RabbitMQ message.

The design is therefore:

``` text
At-Least-Once Delivery
          +
Idempotent Job-State Handling
```

A duplicate message for a terminal `COMPLETED` or `FAILED` job does not
blindly execute the AI workload again.

------------------------------------------------------------------------

## 🔁 Failure Handling

``` mermaid
flowchart TD
    A["Worker receives task"] --> B["Call Groq"]
    B -->|Success| C["Validate output"]
    C --> D["Persist COMPLETED"]
    D --> E["ACK"]

    B -->|Temporary failure| F["Bounded retry"]
    F --> G["Backoff + jitter"]
    G --> A

    F -->|Retry budget exhausted| H["FAILED / DLQ"]
    B -->|Poison message| H
```

AsyncForge treats partial failure as part of the architecture: network
calls fail, workers crash, messages are redelivered, and dependencies
become temporarily unavailable.

------------------------------------------------------------------------

## 📈 Scaling Path

``` text
AI backlog increases?
        ↓
Scale worker replicas

Outbox publishing becomes a bottleneck?
        ↓
Scale dispatchers carefully with safe row claiming

Database connection pressure increases?
        ↓
Bound concurrency and introduce connection pooling

Polling becomes a high-scale bottleneck?
        ↓
Consider CDC using PostgreSQL WAL + Debezium
```

------------------------------------------------------------------------

## 🔐 Security Notes

-   Never expose `DATABASE_URL`, `RABBITMQ_URL`, or `GROQ_API_KEY` to
    the browser.
-   Never commit `.env`.
-   Do not reuse local RabbitMQ credentials in production.
-   Do not return internal stack traces or raw exceptions to clients.
-   Validate AI output before persistence and rendering.

------------------------------------------------------------------------

## 🛣️ Future Improvements

-   `DISPATCHING` outbox state with lease metadata
-   Expired dispatcher lease recovery
-   PostgreSQL partial index for pending outbox events
-   PgBouncer for database connection pooling
-   CDC-based outbox publishing using PostgreSQL WAL and Debezium
-   WebSockets or Server-Sent Events instead of frontend polling
-   OpenTelemetry distributed tracing
-   Queue-depth, latency, and retry dashboards
-   Worker autoscaling based on RabbitMQ queue depth

------------------------------------------------------------------------

## 💡 What I Learned

AsyncForge was built to move beyond CRUD-style backend development and
explore real distributed-system failure modes.

The interesting questions were not:

> *How do I call an AI API?*

They were:

> *What happens if the server crashes between two writes?*

> *What happens if the same message is delivered twice?*

> *What happens if a worker dies before ACKing?*

> *How do I scale processing without coupling it to the web server?*

> *Where is the source of truth when multiple systems coordinate?*

---

> **AsyncForge was built to understand queues, failure, retries, idempotency, transactional outbox, and horizontal scaling by actually implementing them.**

⚡ **Built for failure. Designed to scale.**

---
