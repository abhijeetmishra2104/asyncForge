import { describe, expect, it } from "vitest";
import { AI_RESPONSE_JSON_SCHEMA, aiResponseSchema } from "../lib/ai/types";

describe("Model provider contract", () => {
  it("keeps the JSON Schema and the Zod schema describing the same shape", () => {
    // The two exist because the SDK's Zod helper needs Zod 4 and this project
    // is on Zod 3. If one drifts from the other, a provider starts returning a
    // shape the rest of the pipeline does not expect — so pin them together.
    const zodKeys = Object.keys(aiResponseSchema.shape).sort();
    const jsonKeys = Object.keys(AI_RESPONSE_JSON_SCHEMA.properties).sort();
    expect(jsonKeys).toEqual(zodKeys);
    expect([...AI_RESPONSE_JSON_SCHEMA.required].sort()).toEqual(zodKeys);

    const item = AI_RESPONSE_JSON_SCHEMA.properties.actionItems.items;
    expect([...item.properties.priority.enum]).toEqual(["HIGH", "MEDIUM", "LOW"]);
    expect([...item.required].sort()).toEqual(["description", "priority", "title"]);
  });

  it("accepts a well-formed response and rejects a malformed one", () => {
    const good = {
      summary: "A summary",
      actionItems: [{ title: "Do it", description: "Details", priority: "HIGH" }],
      nextSteps: ["Ship"],
    };
    expect(aiResponseSchema.safeParse(good).success).toBe(true);

    // Priority outside the enum is the realistic drift when swapping models.
    const bad = { ...good, actionItems: [{ ...good.actionItems[0], priority: "URGENT" }] };
    expect(aiResponseSchema.safeParse(bad).success).toBe(false);
  });

  it("selects the provider named by AI_PROVIDER", async () => {
    const { activeProvider, activeModel } = await import("../lib/ai");
    // setup-env.ts sets AI_PROVIDER=claude for the suite.
    expect(activeProvider).toBe("claude");
    expect(activeModel).toBe("claude-haiku-4-5");
  });
});
