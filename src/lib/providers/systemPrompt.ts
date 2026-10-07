import type { CopyLength, CopyProviderInput, CopyRegenField, CopyTone } from "./copy";
import { buildChaochaoBriefWriterSystemPrompt } from "./chaochaoPrompt";
import {
  EMOJI_TONES,
  buildCopySystemPrompt as buildProductionCopySystemPrompt,
  buildCopyUserMessage,
  buildFieldRegenSystemPrompt as buildProductionFieldRegenSystemPrompt,
  buildFieldRegenUserMessage as buildProductionFieldRegenUserMessage,
  buildKnownIpBlock,
  resolveCopyTone,
} from "./systemPromptBase";
export type { SecondhandInfo } from "./systemPromptBase";

export {
  EMOJI_TONES,
  buildCopyUserMessage,
  buildKnownIpBlock,
  resolveCopyTone,
};

const TAIWAN_TRADITIONAL_CUSTOMER_OUTPUT = `【顧客可見語言】
所有顧客可見 AI 產出使用台灣繁中與台灣慣用詞；包含 enriched_title、generated_description_html、generated_faq_html、seo_title、meta_description、why_we_chose_it、product_highlights、provider-generated spec。原始 taobao_title、original_title、raw OCR、raw web cache 保留原文，不改寫來源資料。`;

export function buildCopySystemPrompt(
  tone: CopyTone,
  copyLength: CopyLength,
  secondhandInfo?: Parameters<typeof buildProductionCopySystemPrompt>[2],
  options?: { productBriefMode?: boolean },
): string {
  const base =
    tone === "潮巢導購版" && options?.productBriefMode
      ? buildChaochaoBriefWriterSystemPrompt(
          copyLength,
          secondhandInfo
            ? [
                "【二手／中古商品】",
                "本商品為二手／中古；文案要如實描述品況，不可寫成全新品。",
                secondhandInfo.grade ? `等級：${secondhandInfo.grade}` : "",
                secondhandInfo.condition ? `品況：${secondhandInfo.condition}` : "",
                secondhandInfo.notes ? `備註：${secondhandInfo.notes}` : "",
              ].filter(Boolean).join("\n")
            : "",
        )
      : buildProductionCopySystemPrompt(tone, copyLength, secondhandInfo);
  return `${base}\n\n${TAIWAN_TRADITIONAL_CUSTOMER_OUTPUT}`;
}

export function buildFieldRegenSystemPrompt(
  field: CopyRegenField,
  tone: CopyTone,
  copyLength: CopyLength,
  secondhandInfo?: Parameters<typeof buildProductionFieldRegenSystemPrompt>[3],
): string {
  return `${buildProductionFieldRegenSystemPrompt(field, tone, copyLength, secondhandInfo)}\n\n${TAIWAN_TRADITIONAL_CUSTOMER_OUTPUT}`;
}

export function buildFieldRegenUserMessage(input: CopyProviderInput): string {
  return buildProductionFieldRegenUserMessage(input);
}
