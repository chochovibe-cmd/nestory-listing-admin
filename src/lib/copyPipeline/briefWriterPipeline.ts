import type { CopyProvider, CopyProviderInput, CopyProviderOutput, CopyRegenField } from "@/lib/providers/copy";
import { getCopyFieldValue } from "@/lib/providers/copy";
import { dedupeTitleHead, serializeProductBriefForWriter, type ProductBrief } from "@/lib/providers/productBrief";
import { buildCostRecord, stageCost, type AiStageCost } from "@/lib/ai/aiCost";
import { readChatUsage, resolveTextAiEndpoint, textAiExtraBody, textAiModelId } from "@/lib/providers/textAiEndpoint";
import { COPY_TIMEOUT_MS, externalTimeoutSignal } from "@/lib/providers/externalTimeout";
import { extractFaqPairs, normalizeDescriptionToPlainText, formatBriefDescriptionHtml } from "@/lib/contentGenerator/htmlFormat";
import { normalizeFaqOutput } from "@/lib/contentGenerator/copyFormatRepair";
import { localizeToTaiwanTraditionalText } from "@/lib/zhTwLocalizer";
import { finalizeBriefSeo } from "./seoTemplate";
import { AI_AUTO_FIX_BUDGET_TWD, cleanupBriefCopyText, isMainsPowered, type CopyIssue } from "./copyChecks";

// Exact prompt copied from COPY-A2c §6.
export const BRIEF_REVIEW_SYSTEM_PROMPT = "你是潮巢的文案審稿員。輸入有「事實表」（含款式清單）和一份文案（每句前面有編號）。你只負責找出寫了假事實的句子，不改寫、不新增。\n\n只有這種才刪：句子寫了事實表和款式清單都沒有的「硬事實」——\n1. 角色名、品牌名、商品名；\n2. 數字、尺寸、容量、重量、材質、內容物、贈品、款式數；\n3. 事實表沒有的功能或規格（例如降噪、防水、續航時間、藍牙版本）。\n\n每一筆都要附上證據「term」＝句子裡那個沒根據的詞，必須從句子原樣抄出來。\n\n絕對不要刪：形容、畫面、情境、心情、比喻、使用感受、送禮想像、可愛的誇飾、推薦語氣、驚嘆號。角色或品牌的中英文、別名（例如 Cinnamoroll／大耳狗）不算編造。FAQ 跟其他欄位講到同一件事也不要刪。拿不準就不刪。\n\n只輸出 JSON：{\"sentences\":[{\"id\":3,\"term\":\"64GB\"}],\"faq\":[{\"id\":1,\"term\":\"防水\"}],\"terms\":[{\"field\":\"title|seo_title|seo_description\",\"term\":\"要拿掉的詞\"}]}";
export type ReviewDecision = { sentences: number[]; faq: number[]; terms: { field: string; term: string }[] };
export type ReviewUnit = { id: number; field: "intro" | "audience" | "highlight" | "why" | "seo_description"; text: string; paragraph?: number };
export type ReviewResult = { failed: boolean; deleted: ReviewDecision; deletedTexts: { field: string; text: string; term?: string; reason?: string }[]; rejected: number; cost?: AiStageCost };
const emptyDecision = (): ReviewDecision => ({ sentences: [], faq: [], terms: [] });
const badSentence = /出貨|到貨|代購|工作天|預購|退換|保固|未提供|無法確認|未確認|以實物為準|商品資料|標示為/;
const cannedSentence = /不只是[^。！？]{0,30}更是|^很少見到/;
const sentences = (text: string): string[] => text.match(/[^。！？]+[。！？]?/gu)?.map((x) => x.trim()).filter(Boolean) ?? [];
const cleanSeparators = (text: string): string => text.replace(/(?:[、＋｜]\s*){2,}/g, "｜").replace(/^[、＋等｜\s]+|[、＋等｜\s]+$/g, "").replace(/\s+/g, " ").trim();
function titleDeletionGap(text: string, offset: number, length: number): string {
  return /[a-z0-9]/i.test(text.charAt(offset - 1)) && /[a-z0-9]/i.test(text.charAt(offset + length)) ? " " : "";
}
function removeTitleTerm(text: string, term: string): string {
  return text.replaceAll(term, (_match, offset: number) => titleDeletionGap(text, offset, term.length));
}

const medicalSentence = /治療|療效|治癒|醫療級|醫療用|改善(?:視力|近視|失眠|黑眼圈)|消除(?:黑眼圈|眼袋|皺紋)|預防(?:近視|疾病)|降血壓|治失眠/;
const forbiddenFaq = /指定|怎麼選|如何選|如何挑|選哪|挑哪|隨機|多久|到貨|出貨|發貨|觸感|手感|適合送禮|送禮適合|好用嗎|值得|材質是什麼|是什麼材質/;

export function splitBriefDescription(text: string): { intro: string; audience: string[] } {
  const plain = normalizeDescriptionToPlainText(text).trim();
  let section = "intro";
  const intro: string[] = [], audience: string[] = [];
  for (const line of plain.split(/\n/)) {
    const title = line.trim();
    if (title === "商品介紹") { section = "intro"; continue; }
    if (title === "適合誰") { section = "audience"; continue; }
    if (["收藏亮點", "商品資訊", "購買前提醒"].includes(title)) { section = "other"; continue; }
    if (section === "intro") intro.push(line);
    if (section === "audience" && title) audience.push(title.replace(/^[・•\-]\s*/, ""));
  }
  return { intro: intro.join("\n").replace(/\n{3,}/g, "\n\n").trim(), audience };
}

function description(intro: string, audience: string[]) { return `商品介紹\n${intro}\n\n適合誰\n${audience.map((x) => "・" + x).join("\n")}`; }
export function numberBriefCopy(output: CopyProviderOutput): ReviewUnit[] {
  const body = splitBriefDescription(output.generatedDescriptionHtml);
  const units: Omit<ReviewUnit, "id">[] = [
    ...body.intro.split(/\n\s*\n/).flatMap((part, paragraph) => sentences(part).map((text) => ({ field: "intro" as const, text, paragraph }))),
    ...body.audience.map((text) => ({ field: "audience" as const, text })),
    ...output.productHighlights.map((text) => ({ field: "highlight" as const, text })),
    ...(output.whyWeChoseIt ? [{ field: "why" as const, text: output.whyWeChoseIt }] : []),
    ...sentences(output.metaDescription).map((text) => ({ field: "seo_description" as const, text })),
  ];
  return units.map((unit, index) => ({ ...unit, id: index + 1 }));
}
export function applyBriefReview(output: CopyProviderOutput, raw: unknown, factText: string): { output: CopyProviderOutput; review: ReviewResult } {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw.replace(/^```json\s*|```\s*$/g, "")) : raw;
    if (!value || !Array.isArray(value.sentences) || !Array.isArray(value.faq) || !Array.isArray(value.terms)) throw new Error("bad review");
    const units = numberBriefCopy(output);
    const faq = extractFaqPairs(output.generatedFaqHtml);
    if ([...value.sentences, ...value.faq, ...value.terms].some((v) => !v || typeof v !== "object" || Array.isArray(v))) throw new Error("bad review");
    const normalize = (s: string) => s.normalize("NFKC").replace(/\s/gu, "").toLowerCase();
    const facts = normalize(factText);
    // Numbers carry the fact: "約 20 公分" is supported when the facts say "20cm" — units and spacing differ.
    const numbers = (s: string) => s.normalize("NFKC").match(/\d+(?:\.\d+)?/g) ?? [];
    const factNumbers = new Set(numbers(factText));
    const numbersSupported = (term: string) => numbers(term).length > 0 && numbers(term).every((n) => factNumbers.has(n));
    const validTerm = (term: unknown, text: string): term is string => typeof term === "string" && !!normalize(term) && text.includes(term) && !facts.includes(normalize(term)) && !numbersSupported(term);
    const decision = emptyDecision();
    const deletedTexts: ReviewResult["deletedTexts"] = [];
    let rejected = 0;
    for (const suggestion of value.sentences) {
      const unit = units.find((u) => u.id === suggestion.id);
      if (suggestion.reason === "dup" || !unit || !validTerm(suggestion.term, unit.text) || decision.sentences.includes(unit.id)) { rejected++; continue; }
      decision.sentences.push(unit.id); deletedTexts.push({ field: unit.field, text: unit.text, term: suggestion.term });
    }
    for (const suggestion of value.faq) {
      const item = Number.isInteger(suggestion.id) && suggestion.id > 0 ? faq[suggestion.id - 1] : undefined;
      const text = item ? `Q：${item.question}\nA：${item.answer}` : "";
      if (!item || decision.faq.includes(suggestion.id)) { rejected++; continue; }
      if (suggestion.reason === undefined && validTerm(suggestion.term, text)) {
        decision.faq.push(suggestion.id); deletedTexts.push({ field: "faq", text, term: suggestion.term });
      } else rejected++;
    }
    const kept = units.filter((u) => !decision.sentences.includes(u.id));
    const texts = (field: ReviewUnit["field"]) => kept.filter((u) => u.field === field).map((u) => u.text);
    const intro = [...new Set(kept.filter((u) => u.field === "intro").map((u) => u.paragraph))].map((paragraph) => kept.filter((u) => u.field === "intro" && u.paragraph === paragraph).map((u) => u.text).join("")).join("\n\n");
    const next = { ...output, generatedDescriptionHtml: description(intro, texts("audience")), productHighlights: texts("highlight"), whyWeChoseIt: texts("why").join(""), metaDescription: texts("seo_description").join(""), generatedFaqHtml: normalizeFaqOutput(faq.filter((_, i) => !decision.faq.includes(i + 1)).map((q) => `Q：${q.question}\nA：${q.answer}`).join("\n\n")) };
    const applied: ReviewDecision["terms"] = [];
    for (const term of value.terms) {
      if (!term || term.reason === "dup" || !["title", "seo_title", "seo_description"].includes(term.field) || typeof term.term !== "string") { rejected++; continue; }
      const keys = term.field === "title" ? ["titleItem", "titleDiff", "enrichedTitle"] as const : term.field === "seo_title" ? ["seoTitle"] as const : ["metaDescription"] as const;
      let found = false;
      for (const key of keys) if (validTerm(term.term, next[key] ?? "")) { const text = next[key]!; next[key] = cleanSeparators(key === "metaDescription" ? text.split(term.term).join("") : removeTitleTerm(text, term.term)); deletedTexts.push({ field: key, text, term: term.term }); found = true; }
      if (found) applied.push(term);
      else rejected++;
    }
    decision.terms = applied;
    return { output: next, review: { failed: false, deleted: decision, deletedTexts, rejected } };
  } catch { return { output, review: { failed: true, deleted: emptyDecision(), deletedTexts: [], rejected: 0 } }; }
}

export async function reviewBriefCopy(input: CopyProviderInput, brief: ProductBrief, output: CopyProviderOutput): Promise<{ output: CopyProviderOutput; review: ReviewResult }> {
  let cost: AiStageCost | undefined;
  try {
    const endpoint = resolveTextAiEndpoint(); if (!endpoint) throw new Error("missing endpoint");
    const model = process.env.OPENAI_REVIEW_MODEL?.trim() || "gpt-4o-mini";
    const response = await fetch(endpoint.url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${endpoint.apiKey}` }, signal: externalTimeoutSignal(COPY_TIMEOUT_MS), body: JSON.stringify({ model: textAiModelId(endpoint, model), temperature: 0, max_tokens: 1000, ...textAiExtraBody(endpoint), messages: [{ role: "system", content: BRIEF_REVIEW_SYSTEM_PROMPT }, { role: "user", content: JSON.stringify({ facts: serializeProductBriefForWriter(brief), rawTitle: input.rawTitle, title: [output.titleItem, output.titleDiff].filter(Boolean).join("｜"), seo_title: output.seoTitle, seo_description: output.metaDescription, sentences: numberBriefCopy(output), faq: extractFaqPairs(output.generatedFaqHtml).map((q, i) => ({ id: i + 1, ...q })) }) }] }) });
    if (!response.ok) throw new Error("review failed");
    const payload = await response.json(); const usage = readChatUsage(payload);
    cost = stageCost({ stage: "review", model, via: endpoint.via, usage, reportedCostUsd: usage.reportedCostUsd });
    const factText = [serializeProductBriefForWriter(brief), input.rawTitle, ...(brief.variantNames ?? []), input.variantSummary ?? ""].join("\n");
    const result = applyBriefReview(output, payload?.choices?.[0]?.message?.content, factText);
    return { ...result, review: { ...result.review, cost } };
  } catch { return { output, review: { failed: true, deleted: emptyDecision(), deletedTexts: [], rejected: 0, ...(cost ? { cost } : {}) } }; }
}

export function briefAutoFixCandidates(output: CopyProviderOutput, brief?: ProductBrief): CopyIssue[] {
  const body = splitBriefDescription(output.generatedDescriptionHtml); const issues: CopyIssue[] = [];
  const add = (field: CopyRegenField, message: string) => issues.push({ code: "empty_field", field, message: "【文案檢查】" + message });
  if (body.intro.length < 80 || body.intro.length > 280 || body.audience.length < 2) add("generated_description_html", "商品介紹需 80–280 字，適合誰需 2 點");
  if (output.productHighlights.length < 3 || output.productHighlights.some((x) => x.length > 40)) add("product_highlights", "亮點需至少 3 行、每行不超過 40 字");
  const mid = brief ? cleanTitleMid(output.titleItem ?? "", brief) : (output.titleItem ?? "").trim();
  if (!mid) add("enriched_title", "品項標題是空的");
  else if (mid.length > 15) add("enriched_title", "標題商品名太長");
  const ageText = [body.intro, ...body.audience, output.whyWeChoseIt, output.generatedFaqHtml].join("\n");
  if (/國中生|高中生|國高中生|大學生|小學生|學生妹/.test(ageText)) issues.push({ code: "age_label", field: "review", message: "【文案檢查】客群年齡或身分過於限定" });
  return issues;
}

// The cleaner is deliberately local to successful Brief writing, never to legacy tones.
export function cleanBriefCopy(output: CopyProviderOutput, brief?: ProductBrief): CopyProviderOutput {
  const cleanText = (text: string) => cleanupBriefCopyText(localizeToTaiwanTraditionalText(text));
  const cleanSentence = (text: string) => sentences(cleanText(text)).filter((s) => !badSentence.test(s) && !medicalSentence.test(s) && !cannedSentence.test(s)).join("");
  const body = splitBriefDescription(output.generatedDescriptionHtml);
  const cleanIntro = body.intro.split(/\n\s*\n/).map(cleanSentence).filter(Boolean).join("\n\n");
  const faq = extractFaqPairs(output.generatedFaqHtml).filter((q) => !badSentence.test(q.question + q.answer) && !medicalSentence.test(q.question + q.answer) && !forbiddenFaq.test(q.question) && (isMainsPowered(brief) || !/[台臺]灣|電壓/.test(q.question)));
  const singleLine = (text: string) => cleanText(text).replace(/\s+/g, " ").trim();
  return { ...output, titleItem: singleLine(output.titleItem ?? ""), titleDiff: singleLine(output.titleDiff ?? ""), enrichedTitle: singleLine(output.enrichedTitle), seoTitle: singleLine(output.seoTitle), metaDescription: cleanSentence(output.metaDescription), generatedDescriptionHtml: description(cleanIntro, body.audience.map(cleanSentence).filter(Boolean)), productHighlights: output.productHighlights.map((line) => cleanSentence(line.replace(/^[・•\-]\s*/, ""))).filter(Boolean), whyWeChoseIt: cleanSentence(output.whyWeChoseIt), generatedFaqHtml: normalizeFaqOutput(faq.map((q) => `Q：${cleanText(q.question)}\nA：${cleanSentence(q.answer)}`).join("\n\n")) };
}

export async function runBriefWriterPipeline(args: { input: CopyProviderInput; brief: ProductBrief; provider: CopyProvider; review?: typeof reviewBriefCopy; initialStages?: AiStageCost[] }) {
  const { input, brief, provider } = args;
  let output = cleanBriefCopy(await provider.generate(input), brief);
  const stages: AiStageCost[] = [...(args.initialStages ?? [])];
  const record = (value: CopyProviderOutput, stage: "writer" | "fix") => { if (value.callCosts?.length) { for (const call of value.callCosts) stages.push(stageCost({ stage, model: call.model, via: value.via ?? "none", usage: call.usage, reportedCostUsd: call.usage.reportedCostUsd })); } else if (value.usage) stages.push(stageCost({ stage, model: value.model, via: value.via ?? "none", usage: value.usage, reportedCostUsd: value.usage.reportedCostUsd })); };
  record(output, "writer");
  const reviewed = await (args.review ?? reviewBriefCopy)(input, brief, output); output = reviewed.output;
  if (reviewed.review.cost) stages.push(reviewed.review.cost);
  let retries = output.writerRetries ?? 0;
  const checks = briefAutoFixCandidates(output, brief);
  const pick = checks.find((issue) => issue.code !== "age_label");
  if (pick && buildCostRecord(stages).totalTwd <= AI_AUTO_FIX_BUDGET_TWD && !input.regenerateField) {
    try {
      retries += 1;
      const fix = await provider.generate({ ...input, regenerateField: pick.field as CopyRegenField, regenIssueMessages: checks.filter((x) => x.field === pick.field).map((x) => x.message), currentValues: { enrichedTitle: output.enrichedTitle, generatedDescriptionHtml: output.generatedDescriptionHtml, generatedFaqHtml: output.generatedFaqHtml, seoTitle: output.seoTitle, metaDescription: output.metaDescription, productHighlights: output.productHighlights, whyWeChoseIt: output.whyWeChoseIt } });
      record(fix, "fix");
      if (getCopyFieldValue(fix, pick.field as CopyRegenField).trim()) {
        const key = { enriched_title: "titleItem", generated_description_html: "generatedDescriptionHtml", product_highlights: "productHighlights" }[pick.field] as "titleItem" | "generatedDescriptionHtml" | "productHighlights";
        if (key === "productHighlights") output.productHighlights = fix.productHighlights;
        else if (key === "titleItem") { output.titleItem = fix.titleItem || fix.enrichedTitle; output.titleDiff = fix.titleDiff ?? ""; }
        else output.generatedDescriptionHtml = fix.generatedDescriptionHtml;
        output = cleanBriefCopy(output, brief);
      }
    } catch { /* One optional fix never blocks a successful first draft. */ }
  }
  const finalTitle = assembleBriefTitle(output, brief);
  const seo = finalizeBriefSeo({ seoTitle: output.seoTitle, metaDescription: output.metaDescription, title: finalTitle, descriptionText: output.generatedDescriptionHtml });
  const body = splitBriefDescription(output.generatedDescriptionHtml);
  const descriptionHtml = formatBriefDescriptionHtml({ intro: body.intro, suitableFor: body.audience, highlights: output.productHighlights, info: { ...brief.identity, variantCount: brief.variantCount ?? brief.variantNames.length, specLines: brief.specLines }, archetypeFlags: brief.archetypeFlags, voltage: brief.voltage, requiresVoltage: brief.requiresVoltage, taiwanRisks: brief.taiwanRisks, saleStatus: input.saleStatus });
  output = { ...output, enrichedTitle: finalTitle, seoTitle: seo.seoTitle, metaDescription: seo.metaDescription, generatedDescriptionHtml: descriptionHtml };
  const finalChecks = briefAutoFixCandidates({ ...output, generatedDescriptionHtml: description(body.intro, body.audience) }, brief);
  if (reviewed.review.failed) finalChecks.push({ code: "review_failed", field: "review", message: "review_failed" });
  return { output, finalTitle, seo, descriptionHtml, checks: finalChecks, review: reviewed.review, stages, retries };
}

function cleanTitleMid(item: string, brief: ProductBrief): string {
  const norm = (value: string) => value.replace(/\s/g, "").toLowerCase();
  const head = norm(dedupeTitleHead(brief.identity.brand, brief.identity.ip, brief.identity.brandEnglish, brief.identity.ipEnglish));
  let mid = item.replace(/\s+/g, " ");
  for (const name of [brief.identity.brand, brief.identity.brandEnglish, brief.identity.ip, brief.identity.ipEnglish].filter((x) => x.length >= 2).sort((a,b) => b.length-a.length)) {
    mid = mid.replace(new RegExp(name.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&"), "gi"), (match, offset: number, text: string) => titleDeletionGap(text, offset, match.length));
  }
  const words: string[] = [];
  for (const word of mid.trim().split(/\s+/).filter(Boolean)) {
    const key = norm(word);
    if (["收藏", "周邊", "禮物", "交換禮物", "正版", "正版授權", "官方", "聯名"].includes(word) || head.includes(key) || words.some((prev) => norm(prev).includes(key))) continue;
    words.push(word);
  }
  while (words.length > 1 && words.join(" ").length > 15) words.pop();
  return words.join(" ");
}

export function assembleBriefTitle(output: CopyProviderOutput, brief: ProductBrief): string {
  const head = dedupeTitleHead(brief.identity.brand, brief.identity.ip, brief.identity.brandEnglish, brief.identity.ipEnglish);
  const mid = cleanTitleMid(output.titleItem ?? "", brief) || brief.identity.productType;
  const norm = (value: string) => value.replace(/\s/g, "").toLowerCase();
  let diff = (output.titleDiff ?? "").replace(/[【】]/g, "").replace(/正版授權/g, "").replace(/\+/g, "＋").replace(/(?<=[\p{Script=Han}])[·・‧.•](?=[\p{Script=Han}\d])/gu, "．").replace(/&/g, "＆").replace(/\s*([．＆])\s*/g, "$1").trim();
  const parts = diff.split(/([．＆]|\s+)/).filter(Boolean);
  const kept: { text: string; separator: string }[] = [];
  let separator = "";
  for (const part of parts) {
    if (/^([．＆]|\s+)$/.test(part)) { separator = part; continue; }
    // Single characters ("2", "共") are too short to count as a repeated word.
    if (norm(part).length < 2 || (!norm(head).includes(norm(part)) && !norm(mid).includes(norm(part)))) kept.push({ text: part, separator: kept.length ? separator : "" });
    separator = "";
  }
  const joined = () => kept.map((part) => part.separator + part.text).join("");
  while (kept.length && joined().length > 16) kept.pop();
  diff = joined();
  return cleanupBriefCopyText(localizeToTaiwanTraditionalText([head, mid, diff].filter(Boolean).join(" | "))).replace(/\s*×\s*/gu, " × ");
}
