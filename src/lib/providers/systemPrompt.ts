import type { CopyLength, CopyProviderInput, CopyRegenField, CopyTone } from "./copy";
import { buildChaochaoBriefWriterSystemPrompt, buildChaochaoFieldRegenSystemPrompt } from "./chaochaoPrompt";
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
  productBriefMode = false,
): string {
  if (tone === "潮巢導購版" && productBriefMode) {
    return `${buildChaochaoFieldRegenSystemPrompt(field, copyLength, "", true)}\n\n${TAIWAN_TRADITIONAL_CUSTOMER_OUTPUT}`;
  }
  return `${buildProductionFieldRegenSystemPrompt(field, tone, copyLength, secondhandInfo)}\n\n${TAIWAN_TRADITIONAL_CUSTOMER_OUTPUT}`;
}

export function buildFieldRegenUserMessage(input: CopyProviderInput): string {
  if (input.productBrief?.trim() && input.tone === "潮巢導購版") {
    return [
      `原始品名：${input.rawTitle}`,
      `銷售狀態：${input.saleStatus}`,
      `款式結構：${input.variantSummary ?? ""}`,
      "【唯一可信事實表】", input.productBrief,
      "【既有文案供保持一致】", JSON.stringify(input.currentValues ?? {}),
      input.regenIssueMessages?.length ? "【上一版這一欄的問題，重寫時一定要避開】\n" + input.regenIssueMessages.map((line) => "- " + line.replace(/^【文案檢查】/, "")).join("\n") : "",
    ].filter(Boolean).join("\n\n");
  }
  return buildProductionFieldRegenUserMessage(input);
}
