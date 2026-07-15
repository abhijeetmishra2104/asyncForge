import { z } from "zod";
import { config } from "dotenv";

// Load environment variables from the .env file into process.env
config();

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  RABBITMQ_URL: z.string().url(),
  GROQ_API_KEY: z.string().min(1),
  GROQ_MODEL: z.string().default("openai/gpt-oss-20b"),
  MAX_JOB_ATTEMPTS: z.coerce.number().default(3),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().default(1000),
  OUTBOX_BATCH_SIZE: z.coerce.number().default(20),
  RABBITMQ_PREFETCH: z.coerce.number().default(1),
  RETRY_BASE_DELAY_MS: z.coerce.number().default(5000),
  RETRY_MAX_DELAY_MS: z.coerce.number().default(60000),
  JOB_PROCESSING_TIMEOUT_MS: z.coerce.number().default(300000),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error("❌ Invalid environment variables:", _env.error.format());
  process.exit(1);
}

export const env = _env.data;