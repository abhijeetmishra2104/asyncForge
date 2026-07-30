import Groq from "groq-sdk";
import { env } from "./env";
import { 
  groqRequestsCounter, 
  groqRequestDurationHistogram, 
  groqTokensCounter 
} from "./metrics";

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

export async function executeAITask(prompt: string): Promise<string> {
  // 1. Start the Prometheus timer
  const endTimer = groqRequestDurationHistogram.startTimer({ model: env.GROQ_MODEL });

  try {
    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: env.GROQ_MODEL,
    });

    // 2. Record successful API call
    groqRequestsCounter.inc({ model: env.GROQ_MODEL, status: "success" });

    // 3. Record granular token usage for cost analysis
    if (completion.usage) {
      groqTokensCounter.inc({ model: env.GROQ_MODEL, type: "prompt" }, completion.usage.prompt_tokens);
      groqTokensCounter.inc({ model: env.GROQ_MODEL, type: "completion" }, completion.usage.completion_tokens);
      groqTokensCounter.inc({ model: env.GROQ_MODEL, type: "total" }, completion.usage.total_tokens);
    }

    return completion.choices[0]?.message?.content || "";
    
  } catch (error: any) {
    // 4. Record failures, specifically tagging rate limits (HTTP 429)
    const status = error?.status === 429 ? "rate_limited" : "error";
    groqRequestsCounter.inc({ model: env.GROQ_MODEL, status });
    throw error;
    
  } finally {
    // 5. Stop the timer (happens on both success and failure)
    endTimer();
  }
}