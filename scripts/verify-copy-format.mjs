/**
 * 文案呈現包 verification (no secrets, no network).
 * Covers: ◈ section-header convention, shared sectionHeaders module wiring,
 * sale-status opening notice, emoji tone policy.
 *
 * Run: node scripts/verify-copy-format.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

// --- Mirror of src/lib/contentGenerator/sectionHeaders.ts (keep in sync) ---
const TITLE_TO_LETTER = [
  [/^商品亮點/, "B"],
  [/^適合誰/, "C"],
  [/^商品資訊/, "D"],
  [/^(購買提醒|常見問題|FAQ)/i, "E"]
];
function mirrorMatch(line) {
  const trimmed = line.trim();
  const diamond = trimmed.match(/^◈\s*(.+)$/);
  if (diamond) {
    const title = diamond[1].trim();
    const hit = TITLE_TO_LETTER.find(([re]) => re.test(title));
    return { letter: hit ? hit[1] : null, title };
  }
  const legacy = trimmed.match(/^([A-E])｜\s*(.*)$/);
  if (legacy) {
    const rest = (legacy[2] ?? "").trim();
    const hit = rest ? TITLE_TO_LETTER.find(([re]) => re.test(rest)) : null;
    return { letter: legacy[1], title: hit ? rest : null, inlineContent: hit ? null : rest || null };
  }
  return null;
}

console.log("verify-copy-format:");

await check("sectionHeaders.ts exists with both conventions", () => {
  const src = read("src/lib/contentGenerator/sectionHeaders.ts");
  assert.match(src, /◈/);
  assert.match(src, /\[A-E\]/);
  assert.match(src, /商品亮點/);
});

await check("mirror: ◈ 商品亮點 → B", () => {
  assert.equal(mirrorMatch("◈ 商品亮點").letter, "B");
});
await check("mirror: ◈ 購買提醒 → E", () => {
  assert.equal(mirrorMatch("◈ 購買提醒").letter, "E");
});
await check("mirror: legacy B｜商品亮點 → B (pure header)", () => {
  const m = mirrorMatch("B｜商品亮點");
  assert.equal(m.letter, "B");
  assert.equal(m.title, "商品亮點");
});
await check("mirror: legacy A｜開頭句 keeps inline content", () => {
  const m = mirrorMatch("A｜把日常的空氣換得更柔軟一點。");
  assert.equal(m.letter, "A");
  assert.equal(m.inlineContent, "把日常的空氣換得更柔軟一點。");
});
await check("mirror: normal line is not a header", () => {
  assert.equal(mirrorMatch("・柔軟材質：舒適手感"), null);
});

await check("systemPrompt uses ◈ headers, bans letter prefixes", () => {
  const src = read("src/lib/providers/systemPrompt.ts");
  assert.match(src, /◈ 商品亮點/);
  assert.match(src, /◈ 適合誰/);
  assert.match(src, /◈ 商品資訊/);
  assert.match(src, /◈ 購買提醒/);
  assert.match(src, /禁止使用「A｜」/);
  assert.doesNotMatch(src, /^B｜商品亮點/m);
});

await check("systemPrompt emoji tone policy (2 tones allowed)", () => {
  const src = read("src/lib/providers/systemPrompt.ts");
  assert.match(src, /EMOJI_TONES/);
  assert.match(src, /小編聊天口吻.*可愛周邊輕鬆感|"小編聊天口吻", "可愛周邊輕鬆感"/s);
  assert.match(src, /toneEmojiRule\(tone\)/);
  assert.match(src, /不使用 emoji/);
});

await check("htmlFormat renders section headers as <h3><strong>", () => {
  const src = read("src/lib/contentGenerator/htmlFormat.ts");
  assert.match(src, /matchSectionHeader/);
  assert.match(src, /<h3><strong>◈ /);
});

await check("scenarioKeywords + showmoreCopyRewrite use shared matcher", () => {
  assert.match(read("src/lib/contentGenerator/scenarioKeywords.ts"), /matchSectionHeader/);
  const rewrite = read("src/lib/csv/showmoreCopyRewrite.ts");
  assert.match(rewrite, /matchSectionHeader/);
  assert.match(rewrite, /isSectionHeaderLine/);
  assert.doesNotMatch(rewrite, /const SECTION_HEADER_RE =/);
});

await check("saleStatusNotice covers all four statuses with emoji", () => {
  const src = read("src/lib/contentGenerator/saleStatusNotice.ts");
  for (const s of ["海外代購（約14天）", "預購中", "台灣現貨", "二手現貨"]) {
    assert.match(src, new RegExp(s.replace(/[（）]/g, (m) => "\\" + m)));
  }
  assert.match(src, /14 天/);
});

await check("payload prepends saleStatusNoticeHtml at Shopify boundary", () => {
  const src = read("src/lib/shopify/payload.ts");
  assert.match(src, /saleStatusNoticeHtml\(draft\.sale_status\)/);
  assert.match(src, /from "@\/lib\/contentGenerator\/saleStatusNotice"/);
});

await check("tone cards mark emoji tones", () => {
  const src = read("src/components/listing/WorkspaceInputPanel.tsx");
  assert.match(src, /usesEmoji: true/);
  assert.match(src, /可含Emoji/);
  const emojiTrue = src.match(/usesEmoji: true/g) || [];
  assert.equal(emojiTrue.length, 2, "exactly two tones use emoji");
});

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL passed");
