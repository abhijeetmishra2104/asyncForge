import { GoogleGenAI, Type } from "@google/genai";
import { env } from "./env";
import {
  geminiRequestsCounter,
  geminiRequestDurationHistogram,
  geminiTokensCounter,
} from "./metrics";

const gemini = new GoogleGenAI({
  apiKey: env.GEMINI_API_KEY,
});

/**
 * The model is out of quota. Raw Gemini errors are JSON blobs mentioning
 * billing plans, which end up stored on the job and shown to whoever submitted
 * it — so they are translated into something a person can act on.
 */
export class ModelQuotaError extends Error {}

/** The model is temporarily unavailable or overloaded. Worth retrying. */
export class ModelUnavailableError extends Error {}

export type AIResponse = {
  summary: string;
  actionItems: {
    title: string;
    description: string;
    priority: "HIGH" | "MEDIUM" | "LOW";
  }[];
  nextSteps: string[];
};

const SYSTEM_PROMPT = `
You are an API.

Return ONLY valid JSON.

The response MUST exactly follow this schema:

{
  "summary": "string",
  "actionItems": [
    {
      "title": "string",
      "description": "string",
      "priority": "HIGH"
    }
  ],
  "nextSteps": [
    "string"
  ]
}

Rules:
- Do NOT wrap the JSON inside markdown.
- Do NOT use triple backticks.
- Do NOT explain anything.
- Return ONLY the JSON object.
`;

// Gemini enforces this server-side, so the model cannot return a different
// shape. The SYSTEM_PROMPT above is kept as belt-and-braces documentation of
// the contract the rest of the pipeline (and the mobile client) expects.
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

export async function executeAITask(
  prompt: string
): Promise<AIResponse> {
  const endTimer = geminiRequestDurationHistogram.startTimer({
    model: env.GEMINI_MODEL,
  });

  try {
    const completion = await gemini.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    geminiRequestsCounter.inc({
      model: env.GEMINI_MODEL,
      status: "success",
    });

    const usage = completion.usageMetadata;

    if (usage) {
      geminiTokensCounter.inc(
        {
          model: env.GEMINI_MODEL,
          type: "prompt",
        },
        usage.promptTokenCount ?? 0
      );

      geminiTokensCounter.inc(
        {
          model: env.GEMINI_MODEL,
          type: "completion",
        },
        (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)
      );

      geminiTokensCounter.inc(
        {
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

    geminiRequestsCounter.inc({
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
