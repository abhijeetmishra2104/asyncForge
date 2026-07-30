import Groq from "groq-sdk";
import { env } from "./env";
import {
  groqRequestsCounter,
  groqRequestDurationHistogram,
  groqTokensCounter,
} from "./metrics";

const groq = new Groq({
  apiKey: env.GROQ_API_KEY,
});

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

export async function executeAITask(
  prompt: string
): Promise<AIResponse> {
  const endTimer = groqRequestDurationHistogram.startTimer({
    model: env.GROQ_MODEL,
  });

  try {
    const completion = await groq.chat.completions.create({
      model: env.GROQ_MODEL,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    groqRequestsCounter.inc({
      model: env.GROQ_MODEL,
      status: "success",
    });

    if (completion.usage) {
      groqTokensCounter.inc(
        {
          model: env.GROQ_MODEL,
          type: "prompt",
        },
        completion.usage.prompt_tokens
      );

      groqTokensCounter.inc(
        {
          model: env.GROQ_MODEL,
          type: "completion",
        },
        completion.usage.completion_tokens
      );

      groqTokensCounter.inc(
        {
          model: env.GROQ_MODEL,
          type: "total",
        },
        completion.usage.total_tokens
      );
    }

    const raw = completion.choices[0]?.message?.content ?? "";

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Groq returned invalid JSON.");
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as any).summary !== "string" ||
      !Array.isArray((parsed as any).actionItems) ||
      !Array.isArray((parsed as any).nextSteps)
    ) {
      throw new Error("Groq returned malformed JSON.");
    }

    return parsed as AIResponse;
  } catch (error: any) {
    const status =
      error?.status === 429 ? "rate_limited" : "error";

    groqRequestsCounter.inc({
      model: env.GROQ_MODEL,
      status,
    });

    throw error;
  } finally {
    endTimer();
  }
}