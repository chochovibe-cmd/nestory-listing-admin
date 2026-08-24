import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function gitBlobSha(file) {
  const body = fs.readFileSync(path.join(ROOT, file));
  const header = Buffer.from(`blob ${body.length}\0`, "utf8");
  return crypto.createHash("sha1").update(header).update(body).digest("hex");
}

const COPY_TONE = "潮巢導購版";
const copy = read("src/lib/providers/copy.ts");
const prompt = read("src/lib/providers/systemPrompt.ts");
const workspace = read("src/components/listing/WorkspaceInputPanel.tsx");
const ipToneMap = read("src/lib/providers/ipToneMap.ts");
const sectionHeaders = read("src/lib/contentGenerator/sectionHeaders.ts");
const layoutDoc = read("docs/文案排版規範-2026-07-18.md");

// 1–3. Type/data contract + seventh UI card.
assert.match(copy, /\|\s*"潮巢導購版"/u, "CopyTone must include 潮巢導購版");
assert.match(copy, /COPY_TONES[\s\S]*"潮巢導購版"[\s\S]*"依IP自動匹配"/u, "COPY_TONES must include manual tone before auto-match");
assert.match(workspace, /value:\s*"潮巢導購版"[\s\S]{0,180}emoji:\s*"🛍️"[\s\S]{0,180}desc:\s*"痛點導購・資訊完整"[\s\S]{0,120}usesEmoji:\s*true/u, "WorkspaceInputPanel must render the new tone card contract");
const smallEditorIndex = workspace.indexOf('value: "小編聊天口吻"');
const chaoIndex = workspace.indexOf('value: "潮巢導購版"');
const autoIndex = workspace.indexOf('value: "依IP自動匹配"');
assert.ok(smallEditorIndex >= 0 && chaoIndex > smallEditorIndex && autoIndex > chaoIndex, "new card must sit after 小編聊天口吻 and before auto-match");

// 4. DEFAULT_TONE stays the original first option; do not make the new tone default.
assert.match(workspace, /const DEFAULT_TONE = TONE_OPTIONS\[0\]\.value;/u, "DEFAULT_TONE contract changed");
assert.match(workspace, /const TONE_OPTIONS = \[\s*\{ value: "黑膠文藝收藏感"/u, "first/default tone must remain 黑膠文藝收藏感");

// 5. Manual tone must never be added to DEFAULT_IP_TONE_MAP.
const defaultMapMatch = ipToneMap.match(/DEFAULT_IP_TONE_MAP[\s\S]*?=\s*\{([\s\S]*?)\n\};/u);
assert.ok(defaultMapMatch, "DEFAULT_IP_TONE_MAP not found");
assert.ok(!defaultMapMatch[1].includes(COPY_TONE), "潮巢導購版 must not be an IP auto-map target");
assert.match(prompt, /if \(tone !== "依IP自動匹配"\) return tone;/u, "manual tone pass-through semantic changed");

// 6–8. Tone voice + one dedicated description layout branch, shared evidence/SEO/etc outside it.
assert.match(prompt, /潮巢導購版:\s*"痛點導購、資訊完整/u, "TONE_DESCRIPTIONS missing new tone");
assert.match(prompt, /function descriptionFormatInstruction\(tone: CopyTone\)/u, "description format helper missing");
assert.match(prompt, /if \(tone === CHAOCHAO_SALES_TONE\)/u, "dedicated tone branch missing");
for (const needle of [
  "痛點破題",
  "收藏亮點",
  "為什麼會想帶回家",
  "商品資訊",
  "購買提醒",
  "feature → benefit",
  "evidence safety",
]) {
  assert.ok(prompt.includes(needle), `new tone prompt missing: ${needle}`);
}
assert.match(prompt, /evidence pool 足夠[\s\S]*至少使用 3 個/u, "anti-template 3-unique-facts rule missing");
assert.match(prompt, /evidence pool 不足 3 點[\s\S]*不強迫湊/u, "insufficient-evidence safety exception missing");
assert.match(prompt, /禁止自行發明材質、功能、防水、食品安全、保溫時數、電池續航/u, "factual claim safety missing");
assert.match(prompt, /generated_description_html 可自然使用 0–2 個 emoji/u, "description optional emoji range missing");
assert.match(prompt, /generated_faq_html 可 0–1 個/u, "FAQ optional emoji range missing");
assert.doesNotMatch(prompt, /【欄位硬性｜generated_description_html｜潮巢導購版】/u, "new tone must not inherit mandatory emoji contract");

// 9–10. Shared section semantic aliases; old aliases remain compatible.
assert.match(sectionHeaders, /\^\(商品亮點\|收藏亮點\)[^\n]*"B"/u, "收藏亮點 → B or 商品亮點 → B alias missing");
assert.match(sectionHeaders, /\^\(適合誰\|為什麼會想帶回家\)[^\n]*"C"/u, "為什麼會想帶回家 → C or 適合誰 → C alias missing");
assert.match(sectionHeaders, /\^商品資訊[^\n]*"D"/u, "商品資訊 → D changed");
assert.match(sectionHeaders, /購買提醒[^\n]*"E"/u, "購買提醒 → E changed");

// 11–12. Scope-freeze byte guards against the exact COPY C1 start commit.
const FROZEN_BLOBS = {
  "src/lib/contentGenerator/titleGenerator.ts": "93f0f1cb8cde3059381663b107360cce6de23bd2",
  "src/lib/shopify/productLifecycle.ts": "a7e6b2bbe851aeae12c797be583f0cd64fd1789c",
  "src/lib/shopify/publishDraftSafe.ts": "0d9a992802ca1c165587a785daff9c544d6c8821",
  "src/lib/shopify/runPublishBatch.ts": "a89cb43df865c1f1cf7661c9575988ef37900445",
  "scripts/verify-shopify-lifecycle-safety.mjs": "20025dccc07d3c1aa6494b3dfed8a52c68185640",
};
for (const [file, expected] of Object.entries(FROZEN_BLOBS)) {
  assert.equal(gitBlobSha(file), expected, `scope freeze violated: ${file}`);
}

// Single-field regen must use the same tone-aware description helper; FAQ stays FAQ-only.
assert.match(prompt, /field === "generated_description_html"[\s\S]*descriptionFormatInstruction\(tone\)/u, "description single-field regen must preserve selected tone layout");
assert.match(prompt, /field === "generated_faq_html"[\s\S]*faqFieldEmojiRule\(tone\)/u, "FAQ regen must remain its own field rule");

// Docs are the human-readable single source of truth for the two compatible layouts.
assert.ok(layoutDoc.includes("一般 tone（原有 6 tone，格式完全維持）"), "layout docs must preserve existing tone contract");
assert.ok(layoutDoc.includes("潮巢導購版（COPY C1 專屬 description layout）"), "layout docs missing C1 contract");
assert.ok(layoutDoc.includes("不保存、不模仿、不照抄競品"), "layout-only / no-copying statement missing");

// Quality acceptance: three no-cost fixtures prove the intended buying angle is product-specific,
// rather than the same 可愛／療癒／送禮／收藏 paragraph with a swapped product name.
const fixtures = [
  {
    kind: "A. 絨毛／吊飾類",
    motive: "同一個包背久了想加一個角色辨識點，不必為了換心情整個換包。",
    evidence: ["烏薩奇", "吐司造型", "絨毛吊飾", "可掛包包"],
  },
  {
    kind: "B. 日用品／杯壺類",
    motive: "每天都會拿的喝水用品，也想自然換成自己喜歡的角色，而不是只在收藏櫃看到它。",
    evidence: ["吉伊卡哇", "陶瓷馬克杯", "430mL", "附杯蓋"],
  },
  {
    kind: "C. 電子／桌面功能類",
    motive: "桌面功能已經齊全但少了氣氛，想讓每天播歌的設備同時成為有辨識度的桌面角色。",
    evidence: ["耿鬼", "藍牙音響", "52mm 單體", "5 種 RGB 燈效"],
  },
];
assert.equal(new Set(fixtures.map((fixture) => fixture.motive)).size, 3, "fixture buying motives must differ");
for (const fixture of fixtures) {
  assert.ok(fixture.evidence.length >= 3, `${fixture.kind} fixture needs >=3 product-specific facts`);
  assert.ok(!/可愛.*療癒.*送禮.*收藏/u.test(fixture.motive), `${fixture.kind} must not collapse into generic canned angle`);
}

console.log("COPY C1 Chaochao sales tone verifier passed");
