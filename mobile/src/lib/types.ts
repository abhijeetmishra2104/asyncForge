import { z } from 'zod';

/**
 * Mirrors the backend contract. Kept in sync by hand with:
 *   - prisma/schema.prisma            (JobStatus enum, Job fields)
 *   - lib/gemini.ts                     (AIResponse)
 *   - app/api/status/[jobId]/route.ts (the exact `select` shape)
 *
 * If these drift, this is the file to update.
 */

export const jobStatusSchema = z.enum([
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const prioritySchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type Priority = z.infer<typeof prioritySchema>;

export const actionItemSchema = z.object({
  title: z.string(),
  description: z.string(),
  // Gemini is only prompt-constrained, not schema-constrained, so an unexpected
  // priority string degrades to MEDIUM instead of failing the whole payload.
  priority: prioritySchema.catch('MEDIUM'),
});

export const aiOutputSchema = z.object({
  summary: z.string(),
  actionItems: z.array(actionItemSchema).catch([]),
  nextSteps: z.array(z.string()).catch([]),
});
export type AIOutput = z.infer<typeof aiOutputSchema>;

/**
 * `output` stays `unknown` here on purpose. It is a free-form Json column
 * populated from an LLM response, so a malformed value must not invalidate the
 * rest of the job — we still want to render the status banner and any error.
 * Use `parseOutput` to narrow it at the point of display.
 */
export const jobSchema = z.object({
  id: z.string(),
  status: jobStatusSchema,
  output: z.unknown().nullish(),
  error: z.string().nullish(),
  attempts: z.number().nullish(),
  createdAt: z.string().nullish(),
  startedAt: z.string().nullish(),
});
export type Job = z.infer<typeof jobSchema>;

export const submitResponseSchema = z.object({
  jobId: z.string(),
  status: jobStatusSchema,
});

/** Returns the structured AI result, or null if the worker wrote something unusable. */
export function parseOutput(output: unknown): AIOutput | null {
  if (output == null) return null;
  const result = aiOutputSchema.safeParse(output);
  return result.success ? result.data : null;
}

export function isTerminal(status: JobStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED';
}

/** Matches the `z.string().min(10).max(10000)` guard in app/api/analyze/route.ts. */
export const PROMPT_MIN_LENGTH = 10;
export const PROMPT_MAX_LENGTH = 10000;
