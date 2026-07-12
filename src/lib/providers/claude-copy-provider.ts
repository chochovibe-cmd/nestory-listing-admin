import { CopyProvider, CopyProviderInput, CopyProviderOutput, generateWithParseRetry, makeFieldEmptyCheck } from "./copy";
import {
  buildCopySystemPrompt,
  buildCopyUserMessage,
  buildFieldRegenSystemPrompt,
  buildFieldRegenUserMessage,
  buildKnownIpBlock,
  resolveCopyTone,
  SecondhandInfo,
} from "./systemPrompt";

const DEFAULT_MODEL = process.env.ANTHROPIC_COPY_MODEL || "claude-sonnet-5";

export class ClaudeCopyProvider implements CopyProvider {
  name = "claude";

  async generate(input: CopyProviderInput): Promise<CopyProviderOutput> {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured on the server.");
    }

    // A7: single-field regen swaps in a focused prompt that rewrites one field
    // only; the IP list / detection are irrelevant then.
    const regenField = input.regenerateField;
    // A9 item 2: 依IP自動匹配 is resolved to a concrete tone here, before it
    // ever reaches a prompt string.
    // Manual tones pass through; map only applies for 依IP自動匹配.
    const resolvedTone = resolveCopyTone(input.tone, input.detectedIpName, input.ipToneMap);
    const secondhandInfo: SecondhandInfo | null = input.isSecondhand
      ? { grade: input.secondhandGrade, condition: input.secondhandCondition, notes: input.secondhandNotes }
      : null;
    const system = regenField
      ? buildFieldRegenSystemPrompt(regenField, resolvedTone, input.copyLength, secondhandInfo)
      : buildCopySystemPrompt(resolvedTone, input.copyLength, secondhandInfo);
    const ipBlock = regenField ? null : buildKnownIpBlock(input.knownIpNames);
    // A5: the IP list lives in a cached system block, not the user message, so
    // the per-product user message stays fully variable.
    const user = regenField
      ? buildFieldRegenUserMessage(input)
      : buildCopyUserMessage(input, { omitKnownIpList: true });

    // A5: mark the stable prefix (system prompt + IP list) cache_control so a
    // batch of listings only pays full input price on the first call -- repeat
    // calls read the ~2000-token prompt from cache (~90% input-cost cut per
    // 文案·一·坑2). Note: tone/length are baked into the system prompt today,
    // so cache hits span a same-tone batch; switching tone re-primes the cache.
    const systemBlocks: Array<{ type: "text"; text: string; cache_control: { type: "ephemeral" } }> = [
      { type: "text", text: system, cache_control: { type: "ephemeral" } },
    ];
    if (ipBlock) {
      systemBlocks.push({ type: "text", text: ipBlock, cache_control: { type: "ephemeral" } });
    }

    // A8: parse-failure retry runs the request at most twice; the second pass
    // appends a format reminder to the user message. On regen the emptiness
    // check is scoped to the single field being rewritten.
    const isEmpty = regenField ? makeFieldEmptyCheck(regenField) : undefined;
    return generateWithParseRetry(async (formatReminder) => {
      const userContent = formatReminder ? `${user}\n\n${formatReminder}` : user;

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
          system: systemBlocks,
          messages: [{ role: "user", content: userContent }],
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

      // A13: cache_read/cache_creation are billed at different rates; keep them
      // separate so the cost estimate reflects the caching discount.
      const u = payload?.usage ?? {};
      return {
        text,
        usage: {
          inputTokens: Number(u.input_tokens) || 0,
          outputTokens: Number(u.output_tokens) || 0,
          cachedInputTokens: Number(u.cache_read_input_tokens) || 0,
          cacheCreationTokens: Number(u.cache_creation_input_tokens) || 0,
        },
      };
    }, "claude", DEFAULT_MODEL, isEmpty);
  }
}
