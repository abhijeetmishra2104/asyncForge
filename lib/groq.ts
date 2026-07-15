import Groq from "groq-sdk";
import { z } from "zod";
import { env } from "./env";

export const groq = new Groq({ apiKey: env.GROQ_API_KEY });

export const aiOutputSchema = z.object({
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

export type AIOutput = z.infer<typeof aiOutputSchema>;

export async function executeAITask(prompt: string): Promise<AIOutput> {
  const completion = await groq.chat.completions.create({
    model: env.GROQ_MODEL,
    messages: [
      {
        role: "system",
        content: `You are an expert task planning assistant. Analyze the user's request and return JSON matching this schema exactly:
{
  "summary": "one sentence summary",
  "actionItems": [
    { "title": "...", "description": "...", "priority": "HIGH|MEDIUM|LOW" }
  ],
  "nextSteps": ["..."]
}
Return ONLY valid JSON. No markdown code fences.`,
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const rawContent = completion.choices[0]?.message?.content;
  if (!rawContent) throw new Error("Empty response from Groq");

  try {
    const parsed = JSON.parse(rawContent);
    return aiOutputSchema.parse(parsed);
  } catch (error) {
    throw new Error(`Invalid JSON or schema from Groq: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}