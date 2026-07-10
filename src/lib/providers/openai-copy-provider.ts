import { CopyProvider, CopyProviderInput, CopyProviderOutput, generateWithParseRetry, makeFieldEmptyCheck } from "./copy";
import {
  buildCopySystemPrompt,
  buildCopyUserMessage,
  buildFieldRegenSystemPrompt,
  buildFieldRegenUserMessage,
  resolveCopyTone,
  SecondhandInfo,
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
    // A9 item 2: 依IP自動匹配 is resolved to a concrete tone here, before it
    // ever reaches a prompt string.
    const resolvedTone = resolveCopyTone(input.tone, input.detectedIpName);
    const secondhandInfo: SecondhandInfo | null = input.isSecondhand
      ? { grade: input.secondhandGrade, condition: input.secondhandCondition, notes: input.secondhandNotes }
      : null;
    const system = regenField
      ? buildFieldRegenSystemPrompt(regenField, resolvedTone, input.copyLength, secondhandInfo)
      : buildCopySystemPrompt(resolvedTone, input.copyLength, secondhandInfo);
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

      // A13: prompt_tokens includes auto-cached tokens; split them out so the
      // full-rate input isn't double-counted against the cached portion.
      const u = payload?.usage ?? {};
      const cached = Number(u?.prompt_tokens_details?.cached_tokens) || 0;
      return {
        text,
        usage: {
          inputTokens: Math.max((Number(u.prompt_tokens) || 0) - cached, 0),
          outputTokens: Number(u.completion_tokens) || 0,
          cachedInputTokens: cached,
          cacheCreationTokens: 0,
        },
      };
    }, "openai", DEFAULT_MODEL, isEmpty);
  }
}
