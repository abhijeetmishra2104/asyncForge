import { GoogleGenAI, Type } from "@google/genai";
import { env } from "../env";
import {
  modelRequestsCounter,
  modelRequestDurationHistogram,
  modelTokensCounter,
} from "../metrics";
import {
  ModelQuotaError,
  ModelUnavailableError,
  SYSTEM_PROMPT,
  type AIResponse,
} from "./types";

const PROVIDER = "gemini";

// Built on first use, so a worker running on Claude never needs a Gemini key.
let gemini: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!gemini) {
    if (!env.GEMINI_API_KEY) {
      throw new Error("AI_PROVIDER is 'gemini' but GEMINI_API_KEY is not set.");
    }
    gemini = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }
  return gemini;
}


// Gemini enforces this server-side, so the model cannot return a different
// shape. The shared SYSTEM_PROMPT in ./types states the same contract in
// words, for whichever provider is in use.
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    actionItems: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          priority: {
            type: Type.STRING,
            enum: ["HIGH", "MEDIUM", "LOW"],
          },
        },
        required: ["title", "description", "priority"],
      },
    },
    nextSteps: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ["summary", "actionItems", "nextSteps"],
};

export async function executeWithGemini(prompt: string): Promise<AIResponse> {
  const endTimer = modelRequestDurationHistogram.startTimer({
    provider: PROVIDER,
    model: env.GEMINI_MODEL,
  });

  try {
    const completion = await getClient().models.generateContent({
      model: env.GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    modelRequestsCounter.inc({
      provider: PROVIDER,
      model: env.GEMINI_MODEL,
      status: "success",
    });

    const usage = completion.usageMetadata;

    if (usage) {
      modelTokensCounter.inc(
        {
          provider: PROVIDER,
          model: env.GEMINI_MODEL,
          type: "prompt",
        },
        usage.promptTokenCount ?? 0
      );

      modelTokensCounter.inc(
        {
          provider: PROVIDER,
          model: env.GEMINI_MODEL,
          type: "completion",
        },
        (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)
      );

      modelTokensCounter.inc(
        {
          provider: PROVIDER,
          model: env.GEMINI_MODEL,
          type: "total",
        },
        usage.totalTokenCount ?? 0
      );
    }

    const raw = completion.text ?? "";

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Gemini returned invalid JSON.");
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as any).summary !== "string" ||
      !Array.isArray((parsed as any).actionItems) ||
      !Array.isArray((parsed as any).nextSteps)
    ) {
      throw new Error("Gemini returned malformed JSON.");
    }

    return parsed as AIResponse;
  } catch (error: any) {
    // The Gemini SDK surfaces the HTTP status on ApiError.status; quota
    // exhaustion comes back as 429 the same way the previous provider did.
    const httpStatus = error?.status;

    modelRequestsCounter.inc({
      provider: PROVIDER,
      model: env.GEMINI_MODEL,
      status: httpStatus === 429 ? "rate_limited" : "error",
    });

    // Keep `status` on the rethrown error: the worker reads it to decide how
    // long to back off, and a 429 waits far longer than a transient failure.
    if (httpStatus === 429) {
      throw Object.assign(
        new ModelQuotaError(
          "The AI service is at capacity right now. Please try again in a few minutes."
        ),
        { status: httpStatus }
      );
    }

    if (httpStatus === 503 || httpStatus === 500) {
      throw Object.assign(
        new ModelUnavailableError(
          "The AI service is temporarily unavailable. This will be retried automatically."
        ),
        { status: httpStatus }
      );
    }

    throw error;
  } finally {
    endTimer();
  }
}
