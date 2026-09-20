import { z } from "zod";

/**
 * The contract every provider must satisfy, and the single source of truth for
 * the shape. Both providers validate against this schema, so switching models
 * cannot quietly change what the rest of the pipeline receives — the worker,
 * the status API and the mobile client all depend on it.
 */
export const aiResponseSchema = z.object({
  summary: z.string(),
  actionItems: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
    })
  ),
  nextSteps: z.array(z.string()),
});

export type AIResponse = z.infer<typeof aiResponseSchema>;

/**
 * The same contract as a JSON Schema, for providers that constrain generation
 * server-side. Kept beside the Zod schema deliberately: the Anthropic SDK's
 * Zod helper requires Zod 4, and this project is on Zod 3 — which lib/env.ts
 * and the API routes also depend on. The Zod schema above stays the validator
 * of record, so a drift between the two is caught rather than trusted.
 */
export const AI_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    actionItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
        },
        required: ["title", "description", "priority"],
        additionalProperties: false,
      },
    },
    nextSteps: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "actionItems", "nextSteps"],
  additionalProperties: false,
} as const;

/** What every provider implementation exports. */
export type ModelCall = (prompt: string) => Promise<AIResponse>;

/**
 * The model is out of quota. Raw provider errors are JSON blobs mentioning
 * billing plans, which end up stored on the job and shown to whoever submitted
 * it — so they are translated into something a person can act on.
 *
 * The HTTP status is kept on the error: the worker reads it to decide how long
 * to back off, and a 429 waits far longer than a transient failure.
 */
export class ModelQuotaError extends Error {}

/** Temporarily unavailable or overloaded. Worth retrying shortly. */
export class ModelUnavailableError extends Error {}

/** The model declined the request. Retrying will not change the outcome. */
export class ModelRefusedError extends Error {}

export const SYSTEM_PROMPT = `You turn a user's request into a short structured plan.

Return a concise summary, a few concrete action items each with a priority of
HIGH, MEDIUM or LOW, and a short list of next steps. Be specific and practical.`;
