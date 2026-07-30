import client from 'prom-client';

// 1. Enable default Node.js metrics (CPU, memory, garbage collection, etc.)
client.collectDefaultMetrics({ prefix: 'asyncforge_node_' });

// 2. Export the global registry
export const registry = client.register;

// ==========================================
// 3. JOB PROCESSING METRICS
// ==========================================

export const jobsProcessedCounter = new client.Counter({
  name: 'asyncforge_jobs_processed_total',
  help: 'Total number of AI jobs processed by the workers',
  labelNames: ['status'], // 'success', 'failed', 'retried', 'deadlettered'
});

export const jobDurationHistogram = new client.Histogram({
  name: 'asyncforge_job_duration_seconds',
  help: 'Time taken to process an AI job end-to-end',
  labelNames: ['model'],
  buckets: [0.5, 1, 2, 5, 10, 15, 30, 60], 
});

// ==========================================
// 4. OUTBOX & DISPATCHER METRICS
// ==========================================

export const outboxPublishedCounter = new client.Counter({
  name: 'asyncforge_outbox_published_total',
  help: 'Total number of outbox events successfully published to RabbitMQ',
});

export const outboxPendingGauge = new client.Gauge({
  name: 'asyncforge_outbox_pending_events',
  help: 'Current number of events waiting in the outbox table',
});

export const outboxPollDurationHistogram = new client.Histogram({
  name: 'asyncforge_outbox_poll_duration_seconds',
  help: 'Time taken for the dispatcher to query and lock a batch of outbox events',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5], 
});

export const outboxBatchSizeHistogram = new client.Histogram({
  name: 'asyncforge_outbox_batch_size',
  help: 'Number of events claimed in a single dispatcher poll',
  buckets: [0, 1, 5, 10, 20, 50], 
});

// ==========================================
// 5. GROQ AI METRICS
// ==========================================

export const groqRequestsCounter = new client.Counter({
  name: 'asyncforge_groq_requests_total',
  help: 'Total requests made to the Groq API',
  labelNames: ['model', 'status'], // status: 'success', 'error', 'rate_limited'
});

export const groqRequestDurationHistogram = new client.Histogram({
  name: 'asyncforge_groq_request_duration_seconds',
  help: 'Latency of Groq API calls',
  labelNames: ['model'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 20], 
});

export const groqTokensCounter = new client.Counter({
  name: 'asyncforge_groq_tokens_total',
  help: 'Token usage from Groq API',
  labelNames: ['model', 'type'], // type: 'prompt', 'completion', 'total'
});

// ==========================================
// 6. DATABASE METRICS
// ==========================================

export const dbQueriesCounter = new client.Counter({
  name: 'asyncforge_db_queries_total',
  help: 'Total database queries executed',
  labelNames: ['operation', 'model'], // e.g., operation: 'findUnique', model: 'Job'
});

export const dbQueryDurationHistogram = new client.Histogram({
  name: 'asyncforge_db_query_duration_seconds',
  help: 'Latency of database operations',
  labelNames: ['operation', 'model'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2], 
});