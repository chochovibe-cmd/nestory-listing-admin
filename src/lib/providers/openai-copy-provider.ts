import { CopyProvider, CopyProviderInput, CopyProviderOutput, generateWithParseRetry, makeFieldEmptyCheck } from "./copy";
import {
  buildCopySystemPrompt,
  buildCopyUserMessage,
  buildFieldRegenSystemPrompt,
  buildFieldRegenUserMessage,
} from "./systemPrompt";

const DEFAULT_MODEL = process.env.OPENAI_COPY_MODEL || "gpt-4o";

export class OpenAICopyProvider implements CopyProvider {
  name = "openai";

  async generate(input: CopyProviderInput): Promise<CopyProviderOutput> {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured on the server.");
    }

    // A7: single-field regen swaps in a focused prompt that rewrites one field only.
    const regenField = input.regenerateField;
    const system = regenField
      ? buildFieldRegenSystemPrompt(regenField, input.tone, input.copyLength)
      : buildCopySystemPrompt(input.tone, input.copyLength);
    const user = regenField ? buildFieldRegenUserMessage(input) : buildCopyUserMessage(input);

    // A8: parse-failure retry runs the request at most twice; the second pass
    // appends a format reminder to the user message. On regen the emptiness
    // check is scoped to the single field being rewritten.
    const isEmpty = regenField ? makeFieldEmptyCheck(regenField) : undefined;
    return generateWithParseRetry(async (formatReminder) => {
      const userContent = formatReminder ? `${user}\n\n${formatReminder}` : user;

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
          // A4: no json_object mode -- the model now returns segmented markers,
          // not JSON. json_object would force a `{...}` reply and break parsing.
          messages: [
            { role: "system", content: system },
            { role: "user", content: userContent },
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

      return text;
    }, "openai", DEFAULT_MODEL, isEmpty);
  }
}
