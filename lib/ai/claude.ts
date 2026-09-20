import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { env } from "../env";
import {
  modelRequestDurationHistogram,
  modelRequestsCounter,
  modelTokensCounter,
} from "../metrics";
import {
  AI_RESPONSE_JSON_SCHEMA,
  aiResponseSchema,
  ModelQuotaError,
  ModelRefusedError,
  ModelUnavailableError,
  SYSTEM_PROMPT,
  type AIResponse,
} from "./types";

const PROVIDER = "claude";

// Built on first use rather than at import, so a worker running on Gemini — or
// a `next build` with no key at all — never needs an Anthropic credential.
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error("AI_PROVIDER is 'claude' but ANTHROPIC_API_KEY is not set.");
    }
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function executeWithClaude(prompt: string): Promise<AIResponse> {
  const model = env.ANTHROPIC_MODEL;
  const endTimer = modelRequestDurationHistogram.startTimer({ provider: PROVIDER, model });

  try {
    // messages.parse validates the reply against the schema for us, so a
    // malformed response surfaces as parsed_output === null rather than as
    // JSON that fails somewhere further down the pipeline.
    const response = await getClient().messages.parse({
      model,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      output_config: {
        format: jsonSchemaOutputFormat(AI_RESPONSE_JSON_SCHEMA),
        // Only sent when configured. Summarising a prompt is not hard work, so
        // "low" is right on a model that supports effort — but Haiku 4.5
        // rejects the parameter outright, so it must be absent there rather
        // than set to any value.
        ...(env.ANTHROPIC_EFFORT ? { effort: env.ANTHROPIC_EFFORT } : {}),
      },
      messages: [{ role: "user", content: prompt }],
    });

    if (response.stop_reason === "refusal") {
      modelRequestsCounter.inc({ provider: PROVIDER, model, status: "refused" });
      throw new ModelRefusedError(
        "The AI service declined this request. Try rewording the prompt."
      );
    }

    // parsed_output is null when the reply could not be parsed. Validate it
    // against the Zod schema too, so both providers are held to one contract.
    const parsed = aiResponseSchema.safeParse(response.parsed_output);
    if (!parsed.success) {
      throw new Error("The AI service returned a response that did not match the expected shape.");
    }

    modelRequestsCounter.inc({ provider: PROVIDER, model, status: "success" });
    modelTokensCounter.inc(
      { provider: PROVIDER, model, type: "prompt" },
      response.usage.input_tokens ?? 0
    );
    modelTokensCounter.inc(
      { provider: PROVIDER, model, type: "completion" },
      response.usage.output_tokens ?? 0
    );

    return parsed.data;
  } catch (error) {
    if (error instanceof ModelRefusedError) throw error;

    // Typed SDK errors rather than string matching. Most specific first.
    if (error instanceof Anthropic.RateLimitError) {
      modelRequestsCounter.inc({ provider: PROVIDER, model, status: "rate_limited" });
      throw Object.assign(
        new ModelQuotaError(
          "The AI service is at capacity right now. Please try again in a few minutes."
        ),
        { status: 429 }
      );
    }

    if (error instanceof Anthropic.APIError) {
      modelRequestsCounter.inc({ provider: PROVIDER, model, status: "error" });

      // 529 is Anthropic's "overloaded"; 5xx is transient on any provider.
      if (error.status === 529 || (error.status !== undefined && error.status >= 500)) {
        throw Object.assign(
          new ModelUnavailableError(
            "The AI service is temporarily unavailable. This will be retried automatically."
          ),
          { status: error.status }
        );
      }
      throw error;
    }

    modelRequestsCounter.inc({ provider: PROVIDER, model, status: "error" });
    throw error;
  } finally {
    endTimer();
  }
}
