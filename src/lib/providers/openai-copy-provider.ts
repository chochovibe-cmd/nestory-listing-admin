import { COPY_TIMEOUT_MS, externalTimeoutMessage, externalTimeoutSignal, isExternalTimeout } from "./externalTimeout";
import { readChatUsage, resolveTextAiEndpoint, textAiExtraBody, textAiModelId, textAiErrorTag } from "./textAiEndpoint";
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

function writerTemperature(): number | undefined {
  const raw = process.env.OPENAI_COPY_TEMPERATURE?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 2 ? value : undefined;
}

export class OpenAICopyProvider implements CopyProvider {
  name = "openai";

  async generate(input: CopyProviderInput): Promise<CopyProviderOutput> {
    const endpoint = resolveTextAiEndpoint();

    if (!endpoint) {
      throw new Error("OPENAI_API_KEY is not configured on the server.");
    }

    // A7: single-field regen swaps in a focused prompt that rewrites one field only.
    const regenField = input.regenerateField;
    // A9 item 2: 依IP自動匹配 is resolved to a concrete tone here, before it
    // ever reaches a prompt string.
    // Manual tones pass through; map only applies for 依IP自動匹配.
    const resolvedTone = resolveCopyTone(input.tone, input.detectedIpName, input.ipToneMap);
    const secondhandInfo: SecondhandInfo | null = input.isSecondhand
      ? { grade: input.secondhandGrade, condition: input.secondhandCondition, notes: input.secondhandNotes }
      : null;
    const system = regenField
      ? buildFieldRegenSystemPrompt(regenField, resolvedTone, input.copyLength, secondhandInfo, Boolean(input.productBrief?.trim()))
      : buildCopySystemPrompt(resolvedTone, input.copyLength, secondhandInfo, {
          productBriefMode: Boolean(input.productBrief?.trim()),
        });
    const user = regenField ? buildFieldRegenUserMessage(input) : buildCopyUserMessage(input);

    // A8: parse-failure retry runs the request at most twice; the second pass
    // appends a format reminder to the user message. On regen the emptiness
    // check is scoped to the single field being rewritten.
    const isEmpty = regenField
      ? makeFieldEmptyCheck(regenField)
      : resolvedTone === "潮巢導購版" && input.productBrief?.trim()
        ? (output: CopyProviderOutput) => !output.generatedDescriptionHtml.trim()
        : undefined;
    return generateWithParseRetry(async (formatReminder) => {
      const userContent = formatReminder ? `${user}\n\n${formatReminder}` : user;

      let response: Response;
      try {
        response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${endpoint.apiKey}`,
        },
        signal: externalTimeoutSignal(COPY_TIMEOUT_MS),
        body: JSON.stringify({
          model: textAiModelId(endpoint, DEFAULT_MODEL),
          // A6: cap generous enough for the full 「詳細」copy without truncation.
          max_tokens: 3000,
          ...(writerTemperature() !== undefined ? { temperature: writerTemperature() } : {}),
          ...textAiExtraBody(endpoint),
          // A4: no json_object mode -- the model now returns segmented markers,
          // not JSON. json_object would force a `{...}` reply and break parsing.
          messages: [
            { role: "system", content: system },
            { role: "user", content: userContent },
          ],
        }),
      });
      } catch (error) {
        if (isExternalTimeout(error)) throw new Error(externalTimeoutMessage("copy"));
        throw error;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI copy generation failed (${response.status})${textAiErrorTag(endpoint)}: ${errorText}`);
      }

      const payload = await response.json();
      const text = payload?.choices?.[0]?.message?.content;

      if (typeof text !== "string") {
        throw new Error("OpenAI response did not include message content.");
      }

      return {
        text,
        usage: readChatUsage(payload),
        truncated: payload?.choices?.[0]?.finish_reason === "length",
      };
    }, "openai", DEFAULT_MODEL, isEmpty).then((output) => ({ ...output, via: endpoint.via }));
  }
}
