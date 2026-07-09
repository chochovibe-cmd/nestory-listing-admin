import { CopyProvider, CopyProviderInput, CopyProviderOutput, parseCopyProviderOutput } from "./copy";
import { buildCopySystemPrompt, buildCopyUserMessage } from "./systemPrompt";

const DEFAULT_MODEL = process.env.ANTHROPIC_COPY_MODEL || "claude-sonnet-5";

export class ClaudeCopyProvider implements CopyProvider {
  name = "claude";

  async generate(input: CopyProviderInput): Promise<CopyProviderOutput> {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured on the server.");
    }

    const system = buildCopySystemPrompt(input.tone, input.copyLength);
    const user = buildCopyUserMessage(input);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        // A6: 1500 truncated the 「詳細」length copy (文案風險 #6). 3000 leaves
        // headroom for the full 12-field segmented output without cutting off.
        max_tokens: 3000,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic copy generation failed (${response.status}): ${errorText}`);
    }

    const payload = await response.json();
    const text = payload?.content?.[0]?.text;

    if (typeof text !== "string") {
      throw new Error("Anthropic response did not include message content.");
    }

    return parseCopyProviderOutput(text, "claude", DEFAULT_MODEL);
  }
}
