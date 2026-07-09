import { CopyProvider, CopyProviderInput, CopyProviderOutput, parseCopyProviderJson } from "./copy";
import { buildCopySystemPrompt, buildCopyUserMessage } from "./systemPrompt";

const DEFAULT_MODEL = process.env.OPENAI_COPY_MODEL || "gpt-4o";

export class OpenAICopyProvider implements CopyProvider {
  name = "openai";

  async generate(input: CopyProviderInput): Promise<CopyProviderOutput> {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured on the server.");
    }

    const system = buildCopySystemPrompt(input.tone, input.copyLength);
    const user = buildCopyUserMessage(input);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        // A6: cap generous enough for the full 「詳細」copy without truncation.
        max_tokens: 3000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI copy generation failed (${response.status}): ${errorText}`);
    }

    const payload = await response.json();
    const text = payload?.choices?.[0]?.message?.content;

    if (typeof text !== "string") {
      throw new Error("OpenAI response did not include message content.");
    }

    return parseCopyProviderJson(text, "openai", DEFAULT_MODEL);
  }
}
