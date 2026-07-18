/**
 * P5 層2／層3：knowledge pack + prompt honesty + cold IP search wiring.
 * Run: node scripts/verify-p5-ip-knowledge.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL", msg);
    bad++;
  } else {
    console.log("OK", msg);
  }
}

const packSrc = fs.readFileSync(
  path.join(root, "src/lib/providers/ipKnowledgePack.ts"),
  "utf8",
);
const promptSrc = fs.readFileSync(
  path.join(root, "src/lib/providers/systemPrompt.ts"),
  "utf8",
);
const routeSrc = fs.readFileSync(
  path.join(root, "src/app/api/generate/route.ts"),
  "utf8",
);
const webSrc = fs.readFileSync(
  path.join(root, "src/lib/providers/webSearch/index.ts"),
  "utf8",
);
const mig = fs.readFileSync(
  path.join(root, "supabase/migrations/038_ip_knowledge_pack.sql"),
  "utf8",
);

// Honesty rule present in pack module
assert(
  packSrc.includes("不得作為規格數字與商品事實的來源"),
  "honesty rule string in ipKnowledgePack.ts",
);
assert(
  packSrc.includes("IP_KNOWLEDGE_HONESTY_RULE"),
  "IP_KNOWLEDGE_HONESTY_RULE export",
);
assert(packSrc.includes("IP_KNOWLEDGE_PACK_MAX_CHARS = 600"), "600 char cap");

// Prompt inject uses block field
assert(
  promptSrc.includes("ipKnowledgePromptBlock"),
  "systemPrompt injects ipKnowledgePromptBlock",
);

// Route wiring
assert(routeSrc.includes("buildIpKnowledgePromptBlock"), "route uses pack block");
assert(
  routeSrc.includes("resolveIpBackgroundSearchForGenerate"),
  "route cold IP search",
);
assert(routeSrc.includes("IP_BACKGROUND_NEUTRAL_INSTRUCTION"), "neutral fallback");
assert(routeSrc.includes("mergeWebSearchCacheLayers"), "cache merge");

// Web search layer3
assert(webSrc.includes("buildIpBackgroundSearchQuery"), "IP background query");
assert(webSrc.includes("ipBackground"), "ipBackground cache nest");

// Migration
assert(mig.includes("knowledge_pack jsonb"), "038 adds column");
assert(mig.includes("吉伊卡哇"), "038 seeds 吉伊卡哇");
assert(mig.includes("Miffy"), "038 seeds Miffy");
assert(mig.includes("THE MONSTERS"), "038 seeds THE MONSTERS");

// Parse DEFAULT packs + char limits via dynamic eval of format helpers — source checks
const top21 = [
  "吉伊卡哇",
  "三麗鷗",
  "Mofusand",
  "寶可夢",
  "鬼滅之刃",
  "航海王",
  "火影忍者",
  "咒術迴戰",
  "鏈鋸人",
  "蠟筆小新",
  "間諜家家酒",
  "葬送的芙莉蓮",
  "迪士尼",
  "星際寶貝",
  "美少女戰士",
  "初音未來",
  "THE MONSTERS",
  "哈利波特",
  "Marvel",
  "Miffy",
];
// Sumikko: either Sumikko Gurashi or 角落小夥伴
const hasSumikko =
  packSrc.includes("Sumikko Gurashi") || packSrc.includes("角落小夥伴");
assert(hasSumikko, "Top21 includes 角落／Sumikko");
for (const name of top21) {
  assert(packSrc.includes(name), `pack has ${name}`);
}

// Honesty must appear inside buildIpKnowledgePromptBlock output path
assert(
  packSrc.includes("IP 背景資料包（${IP_KNOWLEDGE_HONESTY_RULE}）") ||
    packSrc.includes("IP 背景資料包（") && packSrc.includes("IP_KNOWLEDGE_HONESTY_RULE"),
  "prompt block embeds honesty rule",
);

// Inject block must include honesty when built — string template check
assert(
  packSrc.includes("buildIpKnowledgePromptBlock") &&
    packSrc.includes("IP_KNOWLEDGE_HONESTY_RULE"),
  "buildIpKnowledgePromptBlock uses honesty rule",
);

// Soft: each pack() body under ~600 — count Chinese-ish length of pack strings
const packCallRe =
  /pack\(\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"\s*,\s*\[([^\]]*)\]/g;
let over = 0;
let count = 0;
let m;
while ((m = packCallRe.exec(packSrc))) {
  count++;
  const keywords = [...m[4].matchAll(/"((?:\\.|[^"\\])*)"/g)].map((x) => x[1]);
  const body = [
    m[1] ? `角色關係：${m[1]}` : "",
    m[2] ? `名場面：${m[2]}` : "",
    m[3] ? `粉絲梗：${m[3]}` : "",
    keywords.length ? `關鍵字：${keywords.join("、")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  if (body.length > 600) {
    over++;
    console.error("OVER_600", body.length, body.slice(0, 40));
  }
}
assert(count >= 21, `parsed pack() count >= 21 (got ${count})`);
assert(over === 0, "all pack bodies <= 600 chars");

// Tone map still has boss edits
const toneSrc = fs.readFileSync(
  path.join(root, "src/lib/providers/ipToneMap.ts"),
  "utf8",
);
assert(toneSrc.includes('Deadpool: "小編聊天口吻"'), "Deadpool=小編");
assert(
  toneSrc.includes('"THE MONSTERS": "黑膠文藝收藏感"') ||
    toneSrc.includes('THE MONSTERS: "黑膠文藝收藏感"'),
  "THE MONSTERS=黑膠",
);

console.log(bad === 0 ? "ALL_PASSED" : `FAILED ${bad}`);
process.exit(bad === 0 ? 0 : 1);
