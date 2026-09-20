import { env } from "../env";
import { executeWithClaude } from "./claude";
import { executeWithGemini } from "./gemini";
import type { AIResponse, ModelCall } from "./types";

export {
  ModelQuotaError,
  ModelRefusedError,
  ModelUnavailableError,
  aiResponseSchema,
} from "./types";
export type { AIResponse, ModelCall } from "./types";

/**
 * Which model runs is a configuration choice, not a code change: set
 * AI_PROVIDER to "claude" or "gemini". Both implementations return the same
 * validated shape and raise the same error types, so the worker's retry and
 * backoff logic is identical either way.
 */
const providers: Record<typeof env.AI_PROVIDER, ModelCall> = {
  claude: executeWithClaude,
  gemini: executeWithGemini,
};

export function executeAITask(prompt: string): Promise<AIResponse> {
  return providers[env.AI_PROVIDER](prompt);
}

/** For metric labels: which provider and model are actually in use. */
export const activeProvider = env.AI_PROVIDER;
export const activeModel =
  env.AI_PROVIDER === "claude" ? env.ANTHROPIC_MODEL : env.GEMINI_MODEL;
